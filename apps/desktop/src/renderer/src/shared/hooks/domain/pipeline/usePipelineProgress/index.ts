import { useEffect, useState } from 'react'
import { applyStageProgress, toOverallPercent, type StagePercents } from '@shared/progress'
import type { PipelineStage } from '@shared/types'
import { onPipelineProgress } from '@renderer/shared/api/events'

interface UsePipelineProgressParams {
  meetingId: string
}

interface ProgressState {
  meetingId: string
  stage: PipelineStage | null
  percents: StagePercents
}

const EMPTY_PERCENTS: StagePercents = {}

/**
 * 이 회의의 진행률 이벤트를 모아 하나의 퍼센트로 만든다.
 * 상태에 meetingId를 함께 담아, 다른 회의로 바뀌면 렌더 중에 초기값으로 되돌린다
 * (effect에서 setState를 다시 부르지 않기 위해서다).
 */
const usePipelineProgress = ({ meetingId }: UsePipelineProgressParams) => {
  const [progress, setProgress] = useState<ProgressState>({
    meetingId,
    stage: null,
    percents: EMPTY_PERCENTS
  })

  useEffect(
    () =>
      onPipelineProgress((event) => {
        if (event.meetingId !== meetingId) return

        setProgress((previous) => ({
          meetingId,
          stage: event.stage,
          percents: applyStageProgress({
            percents: previous.meetingId === meetingId ? previous.percents : EMPTY_PERCENTS,
            stage: event.stage,
            percent: event.percent
          })
        }))
      }),
    [meetingId]
  )

  const isCurrent = progress.meetingId === meetingId

  return {
    stage: isCurrent ? progress.stage : null,
    percent: toOverallPercent({ percents: isCurrent ? progress.percents : EMPTY_PERCENTS })
  }
}

export default usePipelineProgress
