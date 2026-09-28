import { useEffect, useState } from 'react'
import { onUpdateAvailable } from '@renderer/shared/api/events'
import { checkUpdateApi, downloadUpdateApi, installUpdateApi } from '@renderer/shared/api/update'

/**
 * 'idle'은 새 버전을 아직 모르는 상태, 'latest'는 직접 확인했더니 새 버전이 없던 상태.
 * 배너는 새 버전(`version`)이 없으면 아무것도 그리지 않는다
 */
export type UpdateStage =
  'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'downloaded' | 'error'

const CHECK_ERROR_MESSAGE = '업데이트를 확인하지 못했습니다'
const DOWNLOAD_ERROR_MESSAGE = '새 버전을 내려받지 못했습니다'
const INSTALL_ERROR_MESSAGE = '새 버전을 설치하지 못했습니다'

const useUpdate = () => {
  const [version, setVersion] = useState<string | null>(null)
  const [stage, setStage] = useState<UpdateStage>('idle')
  const [error, setError] = useState<string | null>(null)
  const [currentVersion, setCurrentVersion] = useState<string | null>(null)

  useEffect(
    () =>
      onUpdateAvailable((event) => {
        setVersion(event.version)
        setStage('available')
      }),
    []
  )

  /** 설정의 "지금 확인"에서 부른다. 새 버전이 있으면 배너와 같은 받기·설치 흐름으로 이어진다 */
  const check = async () => {
    setStage('checking')
    setError(null)

    try {
      const response = await checkUpdateApi()
      setCurrentVersion(response.currentVersion)
      setVersion(response.availableVersion)
      setStage(response.availableVersion ? 'available' : 'latest')
    } catch (caught) {
      setStage('error')
      setError(caught instanceof Error ? caught.message : CHECK_ERROR_MESSAGE)
    }
  }

  const download = async () => {
    setStage('downloading')
    setError(null)

    try {
      await downloadUpdateApi()
      setStage('downloaded')
    } catch (caught) {
      setStage('error')
      setError(caught instanceof Error ? caught.message : DOWNLOAD_ERROR_MESSAGE)
    }
  }

  /** 성공하면 앱이 종료되므로 이후 상태는 없다 */
  const install = async () => {
    try {
      await installUpdateApi()
    } catch (caught) {
      setStage('error')
      setError(caught instanceof Error ? caught.message : INSTALL_ERROR_MESSAGE)
    }
  }

  return { version, currentVersion, stage, error, check, download, install }
}

export default useUpdate
