import { useCallback, useEffect, useState } from 'react'
import type { LlmStatus } from '@shared/types'
import { getLlmStatusApi } from '@renderer/shared/api/llm'

const LOAD_ERROR_MESSAGE = 'LLM 설정을 불러오지 못했습니다'

/**
 * 요약 화면과 설정 화면이 함께 보는 공급자 상태. 설정 화면의 저장 응답도 같은 모양이라
 * `applyStatus`로 바로 반영한다 (references/architecture.md "LLM 공급자").
 */
const useLlmStatus = () => {
  const [status, setStatus] = useState<LlmStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  // effect에서 부르는 함수라 await 대신 프로미스 체인으로 쓴다 (.claude/rules/hook-guide.md)
  const fetchStatus = useCallback(
    () =>
      getLlmStatusApi()
        .then((next) => {
          setStatus(next)
          setError(null)
        })
        .catch((caught: unknown) =>
          setError(caught instanceof Error ? caught : new Error(LOAD_ERROR_MESSAGE))
        )
        .finally(() => setIsLoading(false)),
    []
  )

  const refetch = useCallback(() => {
    setIsLoading(true)

    return fetchStatus()
  }, [fetchStatus])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  const applyStatus = useCallback((next: LlmStatus) => {
    setStatus(next)
    setError(null)
  }, [])

  return { status, isLoading, error, refetch, applyStatus }
}

export default useLlmStatus
