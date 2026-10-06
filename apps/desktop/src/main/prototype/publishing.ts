import type { SummarySelection } from '@meeting-stt/prototype-contracts/types'
import { getDb } from '../db/connection'
import { requirePrototypeUser } from './authState'
import { enqueueOutbox } from './outbox'
import { upsertPrototypeJob } from './jobs'

export const checkpointAiPublish = ({
  recordingId,
  analysisArtifactId,
  transcriptArtifactId,
  replaceRecordingDocuments = false,
  forcePublish = false,
  selection,
  enqueue = enqueueOutbox
}: {
  recordingId: string
  analysisArtifactId: string
  transcriptArtifactId?: string
  replaceRecordingDocuments?: boolean
  forcePublish?: boolean
  selection?: SummarySelection
  enqueue?: typeof enqueueOutbox
}) => {
  const owner = requirePrototypeUser()
  const db = getDb()
  const comparison = db
    .prepare(
      'SELECT analysis_a_id, analysis_b_id, selection_json FROM prototype_summary_comparisons WHERE owner_id=? AND recording_id=?'
    )
    .get(owner.id, recordingId) as
    | { analysis_a_id: string | null; analysis_b_id: string | null; selection_json: string | null }
    | undefined
  if (comparison) {
    const chosen = comparison.selection_json
      ? (JSON.parse(comparison.selection_json) as SummarySelection)
      : null
    if (!chosen) throw new Error('정리 두 개를 비교한 뒤 발행할 정리를 선택해 주세요')
    const selectedId =
      chosen.selectedVariant === 'A' ? comparison.analysis_a_id : comparison.analysis_b_id
    if (
      (analysisArtifactId === comparison.analysis_a_id ||
        analysisArtifactId === comparison.analysis_b_id) &&
      (analysisArtifactId !== selectedId ||
        !selection ||
        JSON.stringify(selection) !== comparison.selection_json)
    ) {
      throw new Error('선택한 정리만 발행할 수 있습니다')
    }
  }
  const sourceTranscriptId =
    transcriptArtifactId ??
    (
      db
        .prepare(
          `SELECT t.id
    FROM prototype_artifacts t JOIN prototype_artifacts a ON a.owner_id=t.owner_id AND a.recording_id=t.recording_id
    WHERE a.owner_id=@ownerId AND a.id=@analysisArtifactId AND t.kind='transcript'
      AND t.created_at<=a.created_at AND t.rowid<a.rowid
    ORDER BY t.created_at DESC,t.rowid DESC LIMIT 1`
        )
        .get({ ownerId: owner.id, analysisArtifactId }) as { id: string } | undefined
    )?.id

  db.transaction(() => {
    upsertPrototypeJob({
      recordingId,
      kind: 'ai',
      status: 'succeeded',
      stage: 'done',
      outputArtifactId: analysisArtifactId
    })

    const publishJob = db
      .prepare(
        `SELECT status
         FROM prototype_jobs
         WHERE owner_id = @ownerId AND recording_id = @recordingId AND kind = 'publish'`
      )
      .get({ ownerId: owner.id, recordingId }) as { status: string } | undefined
    if (publishJob?.status === 'succeeded' && !forcePublish) return

    upsertPrototypeJob({
      recordingId,
      kind: 'publish',
      status: 'pending',
      stage: 'publishing',
      inputArtifactId: analysisArtifactId
    })

    const existingOutbox = db
      .prepare(
        `SELECT 1
         FROM prototype_outbox
         WHERE owner_id = @ownerId
           AND kind = 'publish'
           AND json_extract(payload_json, '$.recordingId') = @recordingId
           AND json_extract(payload_json, '$.analysisArtifactId') = @analysisArtifactId
         LIMIT 1`
      )
      .get({ ownerId: owner.id, recordingId, analysisArtifactId })
    if (existingOutbox) {
      if (sourceTranscriptId) {
        db.prepare(
          `UPDATE prototype_outbox
          SET payload_json=json_set(payload_json,'$.transcriptArtifactId',@transcriptId)
          WHERE owner_id=@ownerId AND kind='publish' AND status!='succeeded'
            AND json_extract(payload_json,'$.recordingId')=@recordingId
            AND json_extract(payload_json,'$.analysisArtifactId')=@analysisArtifactId
            AND json_extract(payload_json,'$.transcriptArtifactId') IS NULL`
        ).run({
          ownerId: owner.id,
          recordingId,
          analysisArtifactId,
          transcriptId: sourceTranscriptId
        })
      }
      return
    }

    enqueue({
      kind: 'publish',
      payload: {
        recordingId,
        analysisArtifactId,
        ...(selection ? { selection } : {}),
        ...(replaceRecordingDocuments ? { replaceRecordingDocuments: true } : {}),
        ...(sourceTranscriptId ? { transcriptArtifactId: sourceTranscriptId } : {})
      },
      ownerId: owner.id
    })
  })()
}
