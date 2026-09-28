import type { PipelineStage } from './types'

/** 실제로 일이 진행되는 단계. 'done'·'error'는 종료 신호라 진행률 계산에 쓰지 않는다 */
export type PipelineWorkStage = Exclude<PipelineStage, 'done' | 'error'>

export type StagePercents = Partial<Record<PipelineWorkStage, number>>

const FULL_PERCENT = 100

const WORK_STAGES = ['stt', 'diarize', 'merge', 'save'] as const

/**
 * 단계 가중치. 화자 분리가 병목이라 가장 크다 (docs/phase1-results.md의 10분 발췌 기준 STT 35초 / 화자 분리 141초).
 * 체감용 근사치다 — 코어가 넉넉하면 STT와 화자 분리가 병렬로 돌아 경과 시간과 정확히 비례하지 않는다.
 */
const STAGE_WEIGHTS: Record<PipelineWorkStage, number> = {
  stt: 0.3,
  diarize: 0.6,
  merge: 0.05,
  save: 0.05
}

/**
 * 그 단계가 시작됐다면 이미 끝났다고 볼 수 있는 단계들.
 * STT와 화자 분리는 병렬이라 서로 순서가 없지만, merge는 둘 다 끝나야 시작한다.
 */
const PRECEDING_STAGES: Record<PipelineWorkStage, PipelineWorkStage[]> = {
  stt: [],
  diarize: [],
  merge: ['stt', 'diarize'],
  save: ['stt', 'diarize', 'merge']
}

const ALL_COMPLETE: StagePercents = {
  stt: FULL_PERCENT,
  diarize: FULL_PERCENT,
  merge: FULL_PERCENT,
  save: FULL_PERCENT
}

interface ApplyStageProgressParams {
  percents: StagePercents
  stage: PipelineStage
  percent: number
}

/**
 * 진행률 이벤트 하나를 누적 상태에 반영한다. 값은 되돌아가지 않는다 —
 * 병렬 실행이라 두 단계의 이벤트가 번갈아 오고, 낮은 쪽이 막대를 되감으면 안 된다.
 */
export const applyStageProgress = ({
  percents,
  stage,
  percent
}: ApplyStageProgressParams): StagePercents => {
  if (stage === 'error') return percents
  if (stage === 'done') return ALL_COMPLETE

  const clamped = Math.min(FULL_PERCENT, Math.max(0, percent))
  const withPreceding = PRECEDING_STAGES[stage].reduce<StagePercents>(
    (next, earlier) => ({ ...next, [earlier]: FULL_PERCENT }),
    percents
  )

  return { ...withPreceding, [stage]: Math.max(withPreceding[stage] ?? 0, clamped) }
}

/** 단계별 퍼센트를 사용자에게 보여 줄 하나의 진행률(0~100)로 합친다 */
export const toOverallPercent = ({ percents }: { percents: StagePercents }) =>
  Math.round(
    WORK_STAGES.reduce((total, stage) => total + (percents[stage] ?? 0) * STAGE_WEIGHTS[stage], 0)
  )
