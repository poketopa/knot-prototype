import { randomInt } from 'node:crypto'
import type { SummarySelection, SummaryVariant } from '@meeting-stt/prototype-contracts/types'
import type { PrototypeComparison } from '@shared/prototype'
import type {
  SummaryStage,
  TopicAnalysisDocument,
  TopicAnalysisUtterance,
  TopicAnalysisResultV2
} from '@shared/types'
import { getDb } from '../db/connection'
import { findMeeting } from '../db/meetings'
import { createLlmClient } from '../llm/provider'
import { runTopicAnalysis } from '../summary/run'
import {
  findPrototypeArtifact,
  preserveTopicAnalysisArtifacts,
  registerPrototypeArtifact
} from './artifacts'
import { requirePrototypeUser } from './authState'
import { listPrototypeDocuments } from './documents'
import { upsertPrototypeJob } from './jobs'
import { checkpointAiPublish } from './publishing'

interface ComparisonRow {
  transcript_artifact_id: string
  input_json: string
  first_variant: SummaryVariant
  analysis_a_id: string | null
  analysis_b_id: string | null
  comparison_artifact_id: string | null
  selection_json: string | null
}
interface ComparisonInput {
  utterances: TopicAnalysisUtterance[]
  documents: TopicAnalysisDocument[]
  provider: string
  model: string | null
}

export const findPrototypeComparison = (recordingId: string) =>
  getDb()
    .prepare('SELECT * FROM prototype_summary_comparisons WHERE owner_id=? AND recording_id=?')
    .get(requirePrototypeUser().id, recordingId) as ComparisonRow | undefined

const analysisOf = (id: string, recordingId: string) => {
  const row = getDb()
    .prepare(
      "SELECT content_json FROM prototype_artifacts WHERE owner_id=? AND recording_id=? AND id=? AND kind='ai_analysis'"
    )
    .get(requirePrototypeUser().id, recordingId, id) as { content_json: string } | undefined
  if (!row) throw new Error('비교할 정리본을 찾을 수 없습니다')
  const result = JSON.parse(row.content_json) as TopicAnalysisResultV2
  if (result.schemaVersion !== 2 || !Array.isArray(result.topics))
    throw new Error('비교할 정리본 형식이 올바르지 않습니다')
  return result
}

export const getPrototypeComparison = ({
  recordingId
}: {
  recordingId: string
}): PrototypeComparison | null => {
  const row = findPrototypeComparison(recordingId)
  if (!row?.analysis_a_id || !row.analysis_b_id || !row.comparison_artifact_id) return null
  return {
    firstVariant: row.first_variant,
    candidates: [
      { variant: 'A', topics: analysisOf(row.analysis_a_id, recordingId).topics },
      { variant: 'B', topics: analysisOf(row.analysis_b_id, recordingId).topics }
    ],
    selection: row.selection_json ? (JSON.parse(row.selection_json) as SummarySelection) : null
  }
}

export const generatePrototypeComparison = async ({
  recordingId,
  onProgress
}: {
  recordingId: string
  onProgress: (progress: { stage: SummaryStage; percent: number }) => void
}) => {
  const ownerId = requirePrototypeUser().id
  const assertOwner = () => {
    if (requirePrototypeUser().id !== ownerId) throw new Error('계정이 변경되었습니다')
  }
  const client = await createLlmClient()
  assertOwner()
  let row = findPrototypeComparison(recordingId)
  if (!row) {
    if (!findMeeting({ meetingId: recordingId })) throw new Error('녹음을 찾을 수 없습니다')
    const transcript = findPrototypeArtifact({ recordingId, kind: 'transcript' })
    if (!transcript?.content_json) throw new Error('비교할 전사 원본을 찾을 수 없습니다')
    const content = JSON.parse(transcript.content_json) as { utterances: TopicAnalysisUtterance[] }
    if (!Array.isArray(content.utterances)) throw new Error('전사 원본 형식이 올바르지 않습니다')
    const documents = await listPrototypeDocuments()
    assertOwner()
    const input: ComparisonInput = {
      utterances: content.utterances.map(({ id, speakerLabel, text, startSec }) => ({
        id,
        speakerLabel,
        text,
        startSec
      })),
      documents: [...new Set(documents.map((document) => document.domain).filter(Boolean))].map(
        (domain) => ({ id: domain as string, title: domain as string, domain: domain as string })
      ),
      provider: client.provider,
      model: client.model
    }
    getDb()
      .prepare(
        `INSERT INTO prototype_summary_comparisons
      (owner_id,recording_id,transcript_artifact_id,input_json,first_variant,created_at)
      VALUES (?,?,?,?,?,?)`
      )
      .run(
        ownerId,
        recordingId,
        transcript.id,
        JSON.stringify(input),
        randomInt(2) === 0 ? 'A' : 'B',
        Date.now()
      )
    row = findPrototypeComparison(recordingId)!
  }
  const input = JSON.parse(row.input_json) as ComparisonInput
  if (
    (!row.analysis_a_id || !row.analysis_b_id) &&
    (input.provider !== client.provider || input.model !== client.model)
  ) {
    throw new Error(
      '비교를 시작할 때와 AI 설정이 다릅니다. 원래 AI와 모델로 설정한 뒤 다시 시도해 주세요'
    )
  }
  for (const [index, variant] of (['A', 'B'] as const).entries()) {
    const column = variant === 'A' ? 'analysis_a_id' : 'analysis_b_id'
    if (row[column]) continue
    const attempt = await runTopicAnalysis({
      meetingId: recordingId,
      ...input,
      client,
      variant,
      onProgress: ({ stage, percent }) =>
        onProgress({ stage, percent: (index * 100 + percent) / 2 })
    })
    assertOwner()
    if (attempt.result.schemaVersion !== 2)
      throw new Error('주제별 비교 결과 형식이 올바르지 않습니다')
    const analysisId = await preserveTopicAnalysisArtifacts({
      recordingId,
      attempt,
      expectedOwnerId: ownerId
    })
    assertOwner()
    getDb()
      .prepare(
        `UPDATE prototype_summary_comparisons SET ${column}=? WHERE owner_id=? AND recording_id=?`
      )
      .run(analysisId, ownerId, recordingId)
    row = findPrototypeComparison(recordingId)!
  }
  if (!row.comparison_artifact_id) {
    const id = await registerPrototypeArtifact({
      recordingId,
      kind: 'ai_comparison',
      content: {
        schemaVersion: 1,
        transcriptArtifactId: row.transcript_artifact_id,
        candidates: { A: row.analysis_a_id, B: row.analysis_b_id },
        firstVariant: row.first_variant
      },
      promptVersion: 'summary-comparison-v1'
    })
    assertOwner()
    getDb()
      .prepare(
        'UPDATE prototype_summary_comparisons SET comparison_artifact_id=? WHERE owner_id=? AND recording_id=?'
      )
      .run(id, ownerId, recordingId)
  }
  row = findPrototypeComparison(recordingId)!
  if (row.selection_json) {
    const selection = JSON.parse(row.selection_json) as SummarySelection
    checkpointAiPublish({
      recordingId,
      analysisArtifactId:
        selection.selectedVariant === 'A' ? row.analysis_a_id! : row.analysis_b_id!,
      transcriptArtifactId: row.transcript_artifact_id,
      selection
    })
  } else {
    upsertPrototypeJob({ recordingId, kind: 'ai', status: 'succeeded', stage: 'choosing' })
  }
}

export const choosePrototypeComparison = ({
  recordingId,
  selectedVariant,
  reason,
  meetingType,
  otherReason
}: {
  recordingId: string
  selectedVariant: SummaryVariant
  reason: SummarySelection['reason']
  meetingType: SummarySelection['meetingType']
  otherReason?: string
}) => {
  if (
    !['A', 'B'].includes(selectedVariant) ||
    !['decisions_actions', 'accuracy', 'readability', 'other'].includes(reason) ||
    !['multi_agenda', 'interview_feedback', 'introduction_sharing'].includes(meetingType)
  ) {
    throw new Error('정리와 선택 이유, 회의 종류를 모두 골라 주세요')
  }
  if (otherReason !== undefined && (typeof otherReason !== 'string' || otherReason.length > 500))
    throw new Error('기타 이유는 500자 이내로 입력해 주세요')
  const row = findPrototypeComparison(recordingId)
  if (!row?.analysis_a_id || !row.analysis_b_id || !row.comparison_artifact_id)
    throw new Error('정리 두 개가 모두 준비된 뒤 선택할 수 있습니다')
  const selection: SummarySelection = {
    comparisonArtifactId: row.comparison_artifact_id,
    selectedVariant,
    reason,
    meetingType,
    ...(reason === 'other' && otherReason?.trim() ? { otherReason: otherReason.trim() } : {})
  }
  const serialized = JSON.stringify(selection)
  if (row.selection_json && row.selection_json !== serialized)
    throw new Error('이미 선택한 정리는 변경할 수 없습니다')
  const ownerId = requirePrototypeUser().id
  getDb().transaction(() => {
    getDb()
      .prepare(
        'UPDATE prototype_summary_comparisons SET selection_json=? WHERE owner_id=? AND recording_id=?'
      )
      .run(serialized, ownerId, recordingId)
    checkpointAiPublish({
      recordingId,
      analysisArtifactId: selectedVariant === 'A' ? row.analysis_a_id! : row.analysis_b_id!,
      transcriptArtifactId: row.transcript_artifact_id,
      selection
    })
  })()
}
