import { randomUUID } from 'node:crypto'
import type { PrototypeProcessingItem, PrototypeProcessingStage } from '@shared/prototype'
import { getDb } from '../db/connection'
import { findMeeting, listMeetings } from '../db/meetings'
import { requirePrototypeUser } from './authState'
import { emitPrototypeChanged } from './events'

type PrototypeJobKind = 'transcript' | 'ai' | 'publish' | 'sync'
type PrototypeJobStatus = 'pending' | 'running' | 'succeeded' | 'failed'

interface UpsertPrototypeJobParams {
  recordingId: string
  kind: PrototypeJobKind
  status: PrototypeJobStatus
  stage: PrototypeProcessingStage
  error?: string
  inputArtifactId?: string
  outputArtifactId?: string
}

interface PrototypeJobRow {
  recording_id: string
  kind: PrototypeJobKind
  status: PrototypeJobStatus
  stage: PrototypeProcessingStage
  last_error: string | null
  updated_at: number
}

interface RecoverableJobRow {
  recording_id: string
  kind: PrototypeJobKind
}

export const upsertPrototypeJob = ({
  recordingId,
  kind,
  status,
  stage,
  error,
  inputArtifactId,
  outputArtifactId
}: UpsertPrototypeJobParams) => {
  const owner = requirePrototypeUser()
  const timestamp = Date.now()

  getDb()
    .prepare(
      `INSERT INTO prototype_jobs (
         id, owner_id, recording_id, kind, status, stage, last_error,
         input_artifact_id, output_artifact_id, created_at, updated_at
       )
       VALUES (
         @id, @ownerId, @recordingId, @kind, @status, @stage, @lastError,
         @inputArtifactId, @outputArtifactId, @createdAt, @updatedAt
       )
       ON CONFLICT(owner_id, recording_id, kind) DO UPDATE SET
         status = excluded.status,
         stage = excluded.stage,
         last_error = excluded.last_error,
         input_artifact_id = COALESCE(excluded.input_artifact_id, prototype_jobs.input_artifact_id),
         output_artifact_id = COALESCE(excluded.output_artifact_id, prototype_jobs.output_artifact_id),
         updated_at = excluded.updated_at`
    )
    .run({
      id: randomUUID(),
      ownerId: owner.id,
      recordingId,
      kind,
      status,
      stage,
      lastError: error ?? null,
      inputArtifactId: inputArtifactId ?? null,
      outputArtifactId: outputArtifactId ?? null,
      createdAt: timestamp,
      updatedAt: timestamp
    })
  emitPrototypeChanged({ reason: 'processing', recordingId })
}

export const listPrototypeProcessing = () => {
  const owner = requirePrototypeUser()
  const rows = getDb()
    .prepare(
      `SELECT recording_id, kind, status, stage, last_error, updated_at
       FROM prototype_jobs
       WHERE owner_id = @ownerId
       ORDER BY created_at DESC`
    )
    .all({ ownerId: owner.id }) as PrototypeJobRow[]
  const meetings = new Map(listMeetings().map((meeting) => [meeting.id, meeting]))
  const unsyncedRows = getDb()
    .prepare(
      `SELECT json_extract(payload_json, '$.recordingId') AS recording_id, COUNT(*) AS count
       FROM prototype_outbox
       WHERE owner_id = @ownerId AND status != 'succeeded' AND kind != 'events'
       GROUP BY json_extract(payload_json, '$.recordingId')`
    )
    .all({ ownerId: owner.id }) as Array<{ recording_id: string | null; count: number }>
  const unsynced = new Set(
    unsyncedRows
      .filter((row) => typeof row.recording_id === 'string' && row.count > 0)
      .map((row) => row.recording_id as string)
  )
  const syncedArtifactRows = getDb()
    .prepare(
      `SELECT recording_id, kind, COUNT(*) AS count
       FROM prototype_artifacts
       WHERE owner_id = @ownerId
         AND sync_status = 'succeeded'
         AND kind IN ('wav', 'transcript', 'ai_analysis')
       GROUP BY recording_id, kind`
    )
    .all({ ownerId: owner.id }) as Array<{
    recording_id: string
    kind: 'wav' | 'transcript' | 'ai_analysis'
    count: number
  }>
  const syncedArtifacts = new Map<string, Set<string>>()
  for (const row of syncedArtifactRows) {
    const current = syncedArtifacts.get(row.recording_id) ?? new Set<string>()
    current.add(row.kind)
    syncedArtifacts.set(row.recording_id, current)
  }

  const byRecording = new Map<string, PrototypeJobRow[]>()
  for (const row of rows) {
    byRecording.set(row.recording_id, [...(byRecording.get(row.recording_id) ?? []), row])
  }

  return [...meetings.values()].map((meeting): PrototypeProcessingItem => {
    const jobs = byRecording.get(meeting.id) ?? []
    const failed = jobs.find((job) => job.status === 'failed')
    const running = jobs.find((job) => job.status === 'running')
    const pending = jobs.find((job) => job.status === 'pending')
    const active = failed ?? running ?? pending ?? jobs[0]
    const status: PrototypeJobStatus =
      active?.status ??
      (meeting.status === 'error' ? 'failed' : meeting.status === 'done' ? 'succeeded' : 'pending')
    const artifactKinds = syncedArtifacts.get(meeting.id) ?? new Set<string>()
    const requiredJobsSucceeded = ['transcript', 'ai', 'publish'].every((kind) =>
      jobs.some((job) => job.kind === kind && job.status === 'succeeded')
    )
    const requiredArtifactsSynced = ['wav', 'transcript', 'ai_analysis'].every((kind) =>
      artifactKinds.has(kind)
    )
    return {
      meetingId: meeting.id,
      title: meeting.title,
      status,
      stage:
        active?.stage ??
        (meeting.status === 'recording'
          ? 'recording'
          : meeting.status === 'processing'
            ? 'transcribing'
            : meeting.status === 'error'
              ? 'error'
              : 'done'),
      ...(active?.last_error ? { error: active.last_error } : {}),
      saved:
        meeting.status === 'done' &&
        requiredJobsSucceeded &&
        requiredArtifactsSynced &&
        !unsynced.has(meeting.id)
    }
  })
}

export const retryPrototypeProcessing = ({ meetingId }: { meetingId: string }) => {
  if (!findMeeting({ meetingId })) throw new Error('회의를 찾을 수 없습니다')

  const owner = requirePrototypeUser()
  const db = getDb()
  getDb()
    .prepare(
      `UPDATE prototype_jobs
       SET status = 'pending', last_error = NULL, next_retry_at = 0, updated_at = @updatedAt
       WHERE owner_id = @ownerId AND recording_id = @recordingId AND status = 'failed'`
    )
    .run({ ownerId: owner.id, recordingId: meetingId, updatedAt: Date.now() })
  db.prepare(
    `UPDATE prototype_outbox
     SET status = 'pending', next_retry_at = 0, last_error = NULL
     WHERE owner_id = @ownerId
       AND status = 'failed'
       AND kind != 'events'
       AND (
         json_extract(payload_json, '$.recordingId') = @recordingId
         OR json_extract(payload_json, '$.id') = @recordingId
       )`
  ).run({ ownerId: owner.id, recordingId: meetingId })
  const unsynced = db
    .prepare(
      `SELECT 1
       FROM prototype_outbox
       WHERE owner_id = @ownerId
         AND kind != 'events'
         AND status != 'succeeded'
         AND (
           json_extract(payload_json, '$.recordingId') = @recordingId
           OR json_extract(payload_json, '$.id') = @recordingId
         )
       LIMIT 1`
    )
    .get({ ownerId: owner.id, recordingId: meetingId })
  if (unsynced) {
    upsertPrototypeJob({
      recordingId: meetingId,
      kind: 'sync',
      status: 'pending',
      stage: 'syncing'
    })
  }

  return listPrototypeProcessing()
}

export const retryPrototypeJobKinds = ({ meetingId }: { meetingId: string }) => {
  const owner = requirePrototypeUser()
  return getDb()
    .prepare(
      `SELECT kind
       FROM prototype_jobs
       WHERE owner_id = @ownerId AND recording_id = @recordingId AND status = 'pending'`
    )
    .all({ ownerId: owner.id, recordingId: meetingId }) as Array<{ kind: PrototypeJobKind }>
}

export const recoverPrototypeJobs = () => {
  const owner = requirePrototypeUser()
  getDb()
    .prepare(
      `UPDATE prototype_jobs
       SET status = 'pending', updated_at = @updatedAt
       WHERE owner_id = @ownerId AND status = 'running'`
    )
    .run({ ownerId: owner.id, updatedAt: Date.now() })

  return getDb()
    .prepare(
      `SELECT recording_id, kind
       FROM prototype_jobs
       WHERE owner_id = @ownerId
         AND status = 'pending'
         AND kind IN ('transcript', 'ai')
       ORDER BY created_at`
    )
    .all({ ownerId: owner.id }) as RecoverableJobRow[]
}
