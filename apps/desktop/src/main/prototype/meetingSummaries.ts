import type { PrototypeMeetingSummary } from '@shared/prototype'
import type { LlmProvider } from '@shared/types'
import { listMeetings, updateMeetingSummary } from '../db/meetings'
import { fallbackMeetingSummary, type MeetingSummaryContent } from '../summary/meetingSummary'
import { findPrototypeArtifact, registerPrototypeArtifact } from './artifacts'
import { emitPrototypeChanged } from './events'
import { listPrototypeProcessing } from './jobs'

type RefreshState =
  { status: 'queued' | 'running'; error?: never } | { error: string; status?: never }
const refreshStates = new Map<string, RefreshState>()

export const setMeetingSummaryRefreshState = (recordingId: string, state?: RefreshState) => {
  if (state) refreshStates.set(recordingId, state)
  else refreshStates.delete(recordingId)
  emitPrototypeChanged({ reason: 'processing', recordingId })
}

const parseSummary = (raw: string | null): MeetingSummaryContent | null => {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (
      typeof value !== 'object' ||
      value === null ||
      !('schemaVersion' in value) ||
      value.schemaVersion !== 1 ||
      !('headline' in value) ||
      !('body' in value) ||
      typeof value.headline !== 'string' ||
      typeof value.body !== 'string'
    )
      return null
    return { schemaVersion: 1, headline: value.headline, body: value.body }
  } catch {
    return null
  }
}

const fromStoredAnalysis = (raw: string | null): MeetingSummaryContent | null => {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (
      typeof value !== 'object' ||
      value === null ||
      !('schemaVersion' in value) ||
      value.schemaVersion !== 1 ||
      !('topics' in value) ||
      !Array.isArray(value.topics)
    )
      return null
    const topics: Array<{ overview: string }> = []
    for (const topic of value.topics) {
      if (
        typeof topic !== 'object' ||
        topic === null ||
        !('overview' in topic) ||
        typeof topic.overview !== 'string'
      )
        return null
      topics.push({ overview: topic.overview })
    }
    return fallbackMeetingSummary({ topics })
  } catch {
    return null
  }
}

export const persistMeetingSummary = async ({
  recordingId,
  content,
  provider,
  model,
  rawResponses = [],
  allowRevision = false
}: {
  recordingId: string
  content: MeetingSummaryContent
  provider?: LlmProvider
  model?: string | null
  rawResponses?: Array<{ label: string; text: string }>
  allowRevision?: boolean
}) => {
  const existing = findPrototypeArtifact({ recordingId, kind: 'meeting_summary' })
  if (existing && !allowRevision) return existing.id
  for (const response of rawResponses) {
    await registerPrototypeArtifact({
      recordingId,
      kind: 'ai_raw',
      content: { schemaVersion: 1, label: response.label, text: response.text },
      provider,
      model: model ?? undefined,
      promptVersion: 'meeting-summary-v2'
    })
  }
  const id = await registerPrototypeArtifact({
    recordingId,
    kind: 'meeting_summary',
    content,
    provider,
    model: model ?? undefined,
    promptVersion: rawResponses.length ? 'meeting-summary-v2' : 'meeting-summary-v1-backfill'
  })
  updateMeetingSummary({
    meetingId: recordingId,
    summary: [content.headline, content.body].filter(Boolean).join('\n\n')
  })
  return id
}

/** 이전 버전의 AI 분석을 재실행하지 않고 녹음당 정리본 한 개로 옮긴다. */
export const backfillMeetingSummaries = async () => {
  let created = 0
  const processing = new Map(listPrototypeProcessing().map((item) => [item.meetingId, item]))
  for (const meeting of listMeetings()) {
    if (findPrototypeArtifact({ recordingId: meeting.id, kind: 'meeting_summary' })) continue
    if (processing.get(meeting.id)?.status === 'failed') continue
    const analysis = findPrototypeArtifact({ recordingId: meeting.id, kind: 'ai_analysis' })
    const content = fromStoredAnalysis(analysis?.content_json ?? null)
    if (!content) continue
    await persistMeetingSummary({ recordingId: meeting.id, content })
    created += 1
  }
  return created
}

/** 서버 동기화와 무관하게 저장된 로컬 정리본을 바로 읽을 수 있다. */
export const listMeetingSummaries = (): PrototypeMeetingSummary[] => {
  const processing = new Map(listPrototypeProcessing().map((item) => [item.meetingId, item]))
  return listMeetings().map((meeting) => {
    const job = processing.get(meeting.id)
    const refresh = refreshStates.get(meeting.id)
    const stored = findPrototypeArtifact({ recordingId: meeting.id, kind: 'meeting_summary' })
    const canUseHistoricalFallback = job?.status !== 'failed'
    const content =
      parseSummary(stored?.content_json ?? null) ??
      (canUseHistoricalFallback
        ? fromStoredAnalysis(
            findPrototypeArtifact({ recordingId: meeting.id, kind: 'ai_analysis' })?.content_json ??
              null
          )
        : null)
    const status: PrototypeMeetingSummary['status'] = content
      ? content.headline.trim() || content.body.trim()
        ? 'ready'
        : 'empty'
      : job?.status === 'failed' && job.error
        ? 'failed'
        : meeting.status === 'error'
          ? 'failed'
          : meeting.status === 'recording'
            ? 'recording'
            : 'processing'
    return {
      recordingId: meeting.id,
      title: meeting.title,
      startedAt: new Date(meeting.createdAt).toISOString(),
      durationSec: meeting.durationSec,
      status,
      ...(content?.headline ? { headline: content.headline } : {}),
      ...(content?.body ? { body: content.body } : {}),
      ...(status === 'failed' && (job?.error ?? meeting.errorMessage)
        ? { error: job?.error ?? meeting.errorMessage }
        : {}),
      hasTranscript: job?.hasTranscript ?? false,
      ...(refresh?.status ? { refreshStatus: refresh.status } : {}),
      ...(refresh?.error ? { refreshError: refresh.error } : {})
    }
  })
}
