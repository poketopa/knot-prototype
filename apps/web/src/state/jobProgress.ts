/**
 * 워커 진행률 이벤트 → 처리 화면 단계 상태. 순수 함수라 vitest로 검증한다.
 *
 * 워커는 자기 모델을 추론 직전에 받으므로(화자 분리 워커가 분할·임베딩, STT 워커가 VAD·Whisper)
 * "모델 받기"는 별도 단계가 아니라 각 단계의 앞부분(`downloading`)이다.
 */

import type { PipelineProgress } from '../pipeline/runPipeline'
import type { JobStep, JobStepState } from './jobContext'

export const JOB_STEPS: JobStep[] = ['diarize', 'stt', 'merge']

const PERCENT_MAX = 100

/** 전체 진행률에서 단계가 차지하는 몫. 실측 비율(계획 §6)에 맞춰 음성 인식이 가장 크다 */
const STEP_WEIGHTS: Record<JobStep, number> = { diarize: 30, stt: 60, merge: 10 }
/** 받기가 필요한 단계에서 받기 구간이 차지하는 몫. 나머지가 추론이다 */
const DOWNLOAD_SHARE = 0.4

const WAITING: JobStepState = { status: 'waiting', percent: 0, note: '' }

export const initialSteps = (): Record<JobStep, JobStepState> => ({
  diarize: WAITING,
  stt: WAITING,
  merge: WAITING
})

const isJobStep = (stage: PipelineProgress['stage']): stage is JobStep =>
  JOB_STEPS.includes(stage as JobStep)

interface ApplyProgressParams {
  steps: Record<JobStep, JobStepState>
  progress: PipelineProgress
}

/** 이벤트 하나를 반영한 새 단계 상태. 앞 단계는 끝난 것으로, 뒤 단계는 대기로 둔다 */
export const applyProgress = ({ steps, progress }: ApplyProgressParams) => {
  if (!isJobStep(progress.stage)) return steps

  const index = JOB_STEPS.indexOf(progress.stage)
  const current = steps[progress.stage]
  const isDownloading = progress.kind === 'download'
  // 파일마다 0→100을 반복하므로 받기 진행률은 지금까지의 최고값으로 둔다
  const percent =
    isDownloading && current.status === 'downloading'
      ? Math.max(current.percent, progress.percent)
      : progress.percent

  return JOB_STEPS.reduce<Record<JobStep, JobStepState>>(
    (next, step, stepIndex) => {
      if (stepIndex < index) {
        return { ...next, [step]: { status: 'done', percent: PERCENT_MAX, note: '' } }
      }
      if (stepIndex > index) return { ...next, [step]: WAITING }

      return {
        ...next,
        [step]: {
          status: isDownloading ? 'downloading' : 'running',
          percent,
          note: progress.note
        }
      }
    },
    { ...steps }
  )
}

export const completedSteps = (): Record<JobStep, JobStepState> => ({
  diarize: { status: 'done', percent: PERCENT_MAX, note: '' },
  stt: { status: 'done', percent: PERCENT_MAX, note: '' },
  merge: { status: 'done', percent: PERCENT_MAX, note: '' }
})

interface OverallPercentParams {
  steps: Record<JobStep, JobStepState>
  isDownloadExpected: boolean
}

/** 단계 가중치로 합친 전체 진행률 */
export const overallPercent = ({ steps, isDownloadExpected }: OverallPercentParams) => {
  const downloadShare = isDownloadExpected ? DOWNLOAD_SHARE : 0

  const total = JOB_STEPS.reduce((sum, step) => {
    const { status, percent } = steps[step]
    const ratio = percent / PERCENT_MAX

    if (status === 'done') return sum + STEP_WEIGHTS[step]
    if (status === 'downloading') return sum + STEP_WEIGHTS[step] * downloadShare * ratio
    if (status === 'running') {
      return sum + STEP_WEIGHTS[step] * (downloadShare + (1 - downloadShare) * ratio)
    }

    return sum
  }, 0)

  return Math.min(PERCENT_MAX, Math.round(total))
}
