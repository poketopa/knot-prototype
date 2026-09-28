import { useCallback, useEffect, useState } from 'react'
import type { Meeting } from '@shared/types'
import { onMeetingsChanged } from '@renderer/shared/api/events'
import { getMeetingsApi } from '@renderer/shared/api/meetings'

const useMeetings = () => {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  // effect에서 부르는 함수라 await 대신 프로미스 체인으로 쓴다
  // (async 함수는 setState가 effect 안에서 동기 호출된 것으로 취급돼 react-hooks 규칙에 걸린다)
  const fetchMeetings = useCallback(
    () =>
      getMeetingsApi()
        .then((next) => {
          setMeetings(next)
          setError(null)
        })
        .catch((caught: unknown) =>
          setError(caught instanceof Error ? caught : new Error('회의 목록을 불러오지 못했습니다'))
        )
        .finally(() => setIsLoading(false)),
    []
  )

  /** 사용자가 다시 시도할 때는 로딩 상태를 다시 켠다 (첫 로드는 초기값이 이미 true) */
  const refetch = useCallback(() => {
    setIsLoading(true)

    return fetchMeetings()
  }, [fetchMeetings])

  useEffect(() => {
    fetchMeetings()
  }, [fetchMeetings])

  // 사이드바는 언마운트되지 않으므로 main이 알려 줄 때마다 다시 읽는다 (references/architecture.md "목록 갱신").
  // 진행 중 퍼센트는 행의 PipelineProgress가 따로 구독한다
  useEffect(() => onMeetingsChanged(() => void fetchMeetings()), [fetchMeetings])

  return { meetings, isLoading, error, refetch }
}

export default useMeetings
