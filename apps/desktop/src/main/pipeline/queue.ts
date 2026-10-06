import type { PipelineProgressEvent, SummaryProgressEvent } from '@shared/ipc'
import type { PipelineStage, SummaryStage } from '@shared/types'
import { findAudioPath, findMeeting, updateMeetingStatus } from '../db/meetings'
import { getDb } from '../db/connection'
import { ensureSpeakers } from '../db/speakers'
import { replaceUtterances } from '../db/utterances'
import { listUtterances } from '../db/utterances'
import { runGlossaryDraft } from '../glossary/draft'
import { error as logError, info, messageOf } from '../log'
import { notifyMeetingsChanged } from '../meetingsChanged'
import { createMeetingSummary } from '../summary/meetingSummary'
import { persistMeetingSummary, setMeetingSummaryRefreshState } from '../prototype/meetingSummaries'
import { runPipeline } from './run'
import { checkpointAiPublish } from '../prototype/publishing'
import { findPrototypeComparison, generatePrototypeComparison } from '../prototype/comparisons'
export { checkpointAiPublish } from '../prototype/publishing'
import {
  findPrototypeArtifact,
  preserveAiFailureArtifact,
  preserveTranscriptArtifact
} from '../prototype/artifacts'
import { trackPrototypeEvent } from '../prototype/events'
import { recoverPrototypeJobs, upsertPrototypeJob } from '../prototype/jobs'

const DONE_PERCENT = 100

type MeetingJob = { kind: 'pipeline' | 'summary' | 'regenerate'; meetingId: string }

/** 용어 초안은 회의에 묶이지 않고 결과를 invoke로 돌려줘야 해서, 성공·실패 처리를 `run`이 스스로 한다 */
type GlossaryJob = { kind: 'glossary'; run: () => Promise<void> }

/**
 * 파이프라인·요약·용어 초안은 같은 CPU·GPU를 쓴다. 따로 큐를 두면 동시에 돌아 모두 느려지므로
 * 한 큐에서 동시성 1로 처리한다 (references/architecture.md).
 */
type Job = MeetingJob | GlossaryJob

let notifyPipeline: (event: PipelineProgressEvent) => void = () => {}
let notifySummary: (event: SummaryProgressEvent) => void = () => {}
let pending: Job[] = []
let isRunning = false
let activeJob: Job | null = null

/** main이 창을 만든 뒤 한 번 등록한다. 창이 없을 때 보내면 무시된다 */
export const setPipelineProgressListener = (listener: (event: PipelineProgressEvent) => void) => {
  notifyPipeline = listener
}

export const setSummaryProgressListener = (listener: (event: SummaryProgressEvent) => void) => {
  notifySummary = listener
}

const report = ({
  meetingId,
  stage,
  percent
}: {
  meetingId: string
  stage: PipelineStage
  percent: number
}) => notifyPipeline({ meetingId, stage, percent: Math.round(percent) })

interface ReportSummaryParams extends Omit<SummaryProgressEvent, 'stage'> {
  stage: SummaryStage
}

const reportSummary = ({ percent, ...rest }: ReportSummaryParams) =>
  notifySummary({ ...rest, percent: Math.round(percent) })

const processMeeting = async (meetingId: string) => {
  const startedAt = Date.now()
  const audioPath = findAudioPath({ meetingId })
  if (!audioPath) throw new Error('녹음 파일을 찾을 수 없습니다')

  upsertPrototypeJob({
    recordingId: meetingId,
    kind: 'transcript',
    status: 'running',
    stage: 'transcribing'
  })
  updateMeetingStatus({ meetingId, status: 'processing' })
  notifyMeetingsChanged()
  let rawWhisperJson: unknown = null
  const utterances = await runPipeline({
    audioPath,
    speakerCount: findMeeting({ meetingId })?.speakerCount,
    isQuiet: false,
    onProgress: ({ stage, percent }) => report({ meetingId, stage, percent }),
    onRawTranscript: async (raw) => {
      rawWhisperJson = raw
      await preserveTranscriptArtifact({
        recordingId: meetingId,
        rawWhisperJson: raw,
        utterances: []
      })
    }
  })

  report({ meetingId, stage: 'save', percent: 0 })
  ensureSpeakers({
    meetingId,
    labels: [...new Set(utterances.map((utterance) => utterance.speakerLabel))]
  })
  replaceUtterances({ meetingId, utterances })
  await preserveTranscriptArtifact({
    recordingId: meetingId,
    rawWhisperJson,
    utterances: listUtterances({ meetingId })
  })
  getDb().transaction(() => {
    upsertPrototypeJob({
      recordingId: meetingId,
      kind: 'transcript',
      status: 'succeeded',
      stage: 'done'
    })
    updateMeetingStatus({ meetingId, status: 'done' })
    upsertPrototypeJob({
      recordingId: meetingId,
      kind: 'ai',
      status: 'pending',
      stage: 'summarizing'
    })
  })()
  report({ meetingId, stage: 'done', percent: DONE_PERCENT })
  notifyMeetingsChanged()
  info(`회의 ${meetingId} 처리 완료 (발화 ${utterances.length}개)`)

  trackPrototypeEvent({
    eventType: 'processing_stage_succeeded',
    recordingId: meetingId,
    stage: 'transcribing',
    durationMs: Date.now() - startedAt
  })
  enqueueSummaryJob({ meetingId })
}

const summarizeMeeting = async (meetingId: string) => {
  const startedAt = Date.now()
  upsertPrototypeJob({
    recordingId: meetingId,
    kind: 'ai',
    status: 'running',
    stage: 'summarizing'
  })
  const comparison = findPrototypeComparison(meetingId)
  const existingAnalysis = findPrototypeArtifact({ recordingId: meetingId, kind: 'ai_analysis' })
  // 이전 버전에서 완료한 분석은 재생성하지 않고 발행만 복구한다.
  if (!comparison && existingAnalysis) {
    checkpointAiPublish({ recordingId: meetingId, analysisArtifactId: existingAnalysis.id })
    return
  }
  await generatePrototypeComparison({
    recordingId: meetingId,
    onProgress: ({ stage, percent }) => reportSummary({ meetingId, stage, percent })
  })
  trackPrototypeEvent({
    eventType: 'processing_stage_succeeded',
    recordingId: meetingId,
    stage: 'summarizing',
    durationMs: Date.now() - startedAt
  })
  info(`회의 ${meetingId} 정리 두 개 준비 완료`)
}

const regenerateMeetingSummary = async (meetingId: string) => {
  setMeetingSummaryRefreshState(meetingId, { status: 'running' })
  const analysisArtifact = findPrototypeArtifact({ recordingId: meetingId, kind: 'ai_analysis' })
  const analysis = analysisArtifact?.content_json
    ? (JSON.parse(analysisArtifact.content_json) as import('@shared/types').TopicAnalysisResult)
    : { schemaVersion: 1 as const, topics: [] }
  const result = await createMeetingSummary({
    recordingId: meetingId,
    analysis,
    utterances: listUtterances({ meetingId })
  })
  if (!result.content.headline.trim() && !result.content.body.trim()) {
    throw new Error('다시 정리할 전사 내용이 없습니다')
  }
  await persistMeetingSummary({
    recordingId: meetingId,
    content: result.content,
    provider: result.provider,
    model: result.model,
    rawResponses: result.rawResponses,
    allowRevision: true
  })
  setMeetingSummaryRefreshState(meetingId)
  notifyMeetingsChanged()
}

/**
 * 요약 실패는 회의 상태를 건드리지 않는다 — 회의록은 멀쩡하고 요약만 없는 상태다
 * (references/architecture.md).
 */
const failJob = async ({ kind, meetingId }: MeetingJob, message: string, durationMs: number) => {
  if (kind === 'summary') {
    logError(`회의 ${meetingId} 요약 실패: ${message}`)
    await preserveAiFailureArtifact({ recordingId: meetingId, errorMessage: message }).catch(
      (caught) => logError(`회의 ${meetingId} AI 실패 산출물 보존 실패: ${messageOf(caught)}`)
    )
    trackPrototypeEvent({
      eventType: 'processing_stage_failed',
      recordingId: meetingId,
      stage: 'summarizing',
      durationMs,
      errorCode: 'AI_ANALYSIS_FAILED'
    })
    upsertPrototypeJob({
      recordingId: meetingId,
      kind: 'ai',
      status: 'failed',
      stage: 'error',
      error: message
    })
    reportSummary({ meetingId, stage: 'error', percent: 0, errorMessage: message })
    return
  }

  logError(`회의 ${meetingId} 처리 실패: ${message}`)
  trackPrototypeEvent({
    eventType: 'processing_stage_failed',
    recordingId: meetingId,
    stage: 'transcribing',
    durationMs,
    errorCode: 'TRANSCRIPTION_FAILED'
  })
  upsertPrototypeJob({
    recordingId: meetingId,
    kind: 'transcript',
    status: 'failed',
    stage: 'error',
    error: message
  })
  updateMeetingStatus({ meetingId, status: 'error', errorMessage: message })
  report({ meetingId, stage: 'error', percent: 0 })
  notifyMeetingsChanged()
}

const drain = async () => {
  if (isRunning) return
  isRunning = true

  while (pending.length) {
    const [job, ...rest] = pending
    pending = rest
    activeJob = job

    if (job.kind === 'glossary') {
      await job.run()
      activeJob = null
      continue
    }

    const startedAt = Date.now()
    try {
      await (job.kind === 'summary'
        ? summarizeMeeting(job.meetingId)
        : job.kind === 'regenerate'
          ? regenerateMeetingSummary(job.meetingId)
          : processMeeting(job.meetingId))
    } catch (caught) {
      if (job.kind === 'regenerate') {
        logError(`회의 ${job.meetingId} 정리 재생성 실패: ${messageOf(caught)}`)
        setMeetingSummaryRefreshState(job.meetingId, { error: messageOf(caught) })
      } else {
        await failJob(job, messageOf(caught), Date.now() - startedAt)
      }
    } finally {
      activeJob = null
    }
  }

  isRunning = false
}

const enqueue = (job: Job) => {
  if (job.kind !== 'glossary') {
    const sameMeetingJob = (candidate: Job | null) =>
      candidate?.kind === job.kind && candidate.meetingId === job.meetingId
    if (sameMeetingJob(activeJob) || pending.some(sameMeetingJob)) return
  }
  pending = [...pending, job]
  void drain()
}

/** 동시성 1. 여러 회의를 동시에 돌리지 않는다 (references/pitfalls.md) */
export const enqueuePipelineJob = ({ meetingId }: { meetingId: string }) =>
  enqueue({ kind: 'pipeline', meetingId })

/** 같은 회의의 요약이 실행 중이거나 줄 서 있으면 두 번 돌리지 않는다 */
export const enqueueSummaryJob = ({ meetingId }: { meetingId: string }) =>
  enqueue({ kind: 'summary', meetingId })

/** 이전 정리본은 유지하고, 기존 전사에서 새 정리본을 생성한다. */
export const enqueueMeetingSummaryRegeneration = ({ meetingId }: { meetingId: string }) => {
  if (!findMeeting({ meetingId })) throw new Error('회의를 찾을 수 없습니다')
  if (!findPrototypeArtifact({ recordingId: meetingId, kind: 'meeting_summary' })) {
    throw new Error('다시 만들 정리본이 없습니다')
  }
  const sameJob = (job: Job | null) => job?.kind === 'regenerate' && job.meetingId === meetingId
  if (sameJob(activeJob) || pending.some(sameJob)) return
  setMeetingSummaryRefreshState(meetingId, { status: 'queued' })
  enqueue({ kind: 'regenerate', meetingId })
}

export const isPipelineQueueBusy = () => isRunning || pending.length > 0

export const recoverQueuedPrototypeJobs = () => {
  for (const job of recoverPrototypeJobs()) {
    if (job.kind === 'transcript') enqueuePipelineJob({ meetingId: job.recording_id })
    if (job.kind === 'ai') enqueueSummaryJob({ meetingId: job.recording_id })
  }
}

/** 초안이 끝나면 풀리는 Promise. 앞선 회의 처리가 있으면 그 뒤에 돈다 */
export const enqueueGlossaryDraft = ({ teamDescription }: { teamDescription: string }) =>
  new Promise<string[]>((resolve, reject) => {
    enqueue({
      kind: 'glossary',
      run: () =>
        runGlossaryDraft({ teamDescription }).then(resolve, (caught: unknown) => {
          logError(`용어 초안 실패: ${messageOf(caught)}`)
          reject(caught)
        })
    })
  })
