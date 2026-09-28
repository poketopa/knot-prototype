import { useCallback, useEffect, useState } from 'react'
import { getSetupStatusApi } from '@renderer/shared/api/setup'

const LOAD_ERROR_MESSAGE = '처음 설정 상태를 확인하지 못했습니다'

const useSetupStatus = () => {
  const [isComplete, setIsComplete] = useState<boolean | null>(null)
  const [error, setError] = useState<Error | null>(null)

  const refetch = useCallback(
    () =>
      getSetupStatusApi()
        .then((next) => {
          setIsComplete(next.isComplete)
          setError(null)
        })
        .catch((caught: unknown) => {
          setError(caught instanceof Error ? caught : new Error(LOAD_ERROR_MESSAGE))
          setIsComplete(false)
        }),
    []
  )

  useEffect(() => {
    refetch()
  }, [refetch])

  return { isComplete, error, refetch }
}

export default useSetupStatus
