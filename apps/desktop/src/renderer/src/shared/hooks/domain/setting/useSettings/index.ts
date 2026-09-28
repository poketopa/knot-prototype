import { useCallback, useEffect, useState } from 'react'
import type { AppSettings } from '@shared/types'
import { getSettingsApi, updateSettingsApi } from '@renderer/shared/api/settings'

const useSettings = () => {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  // effect에서 부르는 함수라 await 대신 프로미스 체인으로 쓴다 (.claude/rules/hook-guide.md)
  const fetchSettings = useCallback(
    () =>
      getSettingsApi()
        .then((next) => {
          setSettings(next)
          setError(null)
        })
        .catch((caught: unknown) =>
          setError(caught instanceof Error ? caught : new Error('설정을 불러오지 못했습니다'))
        )
        .finally(() => setIsLoading(false)),
    []
  )

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  /** 설정은 전체를 한 번에 저장한다. 바뀐 항목만 넘기면 나머지는 현재 값을 유지한다 */
  const updateSettings = async (changes: Partial<AppSettings>) => {
    if (!settings) return

    try {
      setSettings(await updateSettingsApi({ ...settings, ...changes }))
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error('설정을 저장하지 못했습니다'))
    }
  }

  return { settings, isLoading, error, updateSettings }
}

export default useSettings
