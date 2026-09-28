import { useEffect, useState } from 'react'
import type { SummaryStage } from '@shared/types'
import { onSummaryProgress } from '@renderer/shared/api/events'
import { createSummaryApi } from '@renderer/shared/api/summary'

interface UseSummaryParams {
  meetingId: string
  /** DB에 이미 있는 요약. 새로 만들면 그 결과로 덮어쓴다 */
  initialSummary?: string
}

const REQUEST_ERROR_MESSAGE = '요약을 시작하지 못했습니다'

const useSummary = ({ meetingId, initialSummary }: UseSummaryParams) => {
  const [generatedSummary, setGeneratedSummary] = useState<string | null>(null)
  const [stage, setStage] = useState<SummaryStage | null>(null)
  const [percent, setPercent] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // 이번에 만든 요약이 있으면 그것을, 없으면 DB에 저장돼 있던 값을 보여준다.
  // 회의를 옮길 때의 초기화는 SummarySection의 key(meetingId) 재마운트가 담당한다
  const summary = generatedSummary ?? initialSummary ?? ''

  useEffect(
    () =>
      onSummaryProgress((event) => {
        if (event.meetingId !== meetingId) return

        setStage(event.stage)
        setPercent(event.percent)
        if (event.stage === 'done' && event.summary) setGeneratedSummary(event.summary)
        setError(event.stage === 'error' ? (event.errorMessage ?? REQUEST_ERROR_MESSAGE) : null)
      }),
    [meetingId]
  )

  const createSummary = async () => {
    setStage('summarize')
    setPercent(0)
    setError(null)

    try {
      await createSummaryApi({ meetingId })
    } catch (caught) {
      setStage('error')
      setError(caught instanceof Error ? caught.message : REQUEST_ERROR_MESSAGE)
    }
  }

  return {
    summary,
    stage,
    percent,
    error,
    isRunning: stage === 'summarize' || stage === 'reduce',
    createSummary
  }
}

export default useSummary
