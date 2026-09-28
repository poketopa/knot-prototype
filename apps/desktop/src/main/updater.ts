import { is } from '@electron-toolkit/utils'
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { CheckUpdateResponse } from '@shared/ipc'

import { info, messageOf, warn } from './log'
import { pickAvailableVersion } from './updateResult'

const DEV_MODE_MESSAGE = '개발 모드에서는 업데이트를 확인할 수 없습니다'
const PROTOTYPE_UPDATE_MESSAGE = '프로토타입 빌드에서는 업데이트를 확인하지 않습니다'
const CHECK_FAILED_MESSAGE = '업데이트를 확인하지 못했습니다. 네트워크 연결을 확인해 주세요'
const IS_PROTOTYPE_BUILD = true

/** 새 버전을 찾아도 내려받지 않는다. 받기·설치는 사용자가 누를 때만 한다 */
const findAvailableVersion = async () => {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  const result = await autoUpdater.checkForUpdates()

  return pickAvailableVersion(result)
}

/**
 * 자동 업데이트는 **기본이 꺼짐**이다. 설정(`update.check`)을 켠 사용자만 확인한다 —
 * "네트워크는 모델 다운로드 한 번뿐"이라는 약속을 지키기 위해서다 (`references/distribution.md`).
 * 새 버전을 발견해도 내려받지 않고 알리기만 한다.
 */
export const checkForUpdates = async ({ isEnabled }: { isEnabled: boolean }) => {
  if (IS_PROTOTYPE_BUILD) return null
  if (!isEnabled || is.dev) return null

  try {
    const version = await findAvailableVersion()
    if (version) info(`새 버전이 있습니다: ${version}`)

    return version
  } catch (caught) {
    // 오프라인이 정상 상태인 앱이다. 실패는 로그만 남기고 넘어간다
    warn(`업데이트 확인 실패: ${messageOf(caught)}`)

    return null
  }
}

/**
 * 설정의 "지금 확인" 버튼에서 부른다. 사용자가 직접 요청한 것이라 `update.check` 설정을 보지 않고,
 * 실패는 삼키지 않고 안내 문구로 던진다 (`references/distribution.md` 7절).
 */
export const checkForUpdatesNow = async () => {
  if (IS_PROTOTYPE_BUILD) throw new Error(PROTOTYPE_UPDATE_MESSAGE)
  if (is.dev) throw new Error(DEV_MODE_MESSAGE)

  const currentVersion = app.getVersion()
  try {
    const availableVersion = await findAvailableVersion()
    if (availableVersion) info(`새 버전이 있습니다: ${availableVersion}`)

    const response: CheckUpdateResponse = { currentVersion, availableVersion }

    return response
  } catch (caught) {
    warn(`업데이트 수동 확인 실패: ${messageOf(caught)}`)
    throw new Error(CHECK_FAILED_MESSAGE)
  }
}

/** 사용자가 "받기"를 눌렀을 때만 내려받는다. 다 받을 때까지 resolve되지 않는다 */
export const downloadUpdate = async () => {
  await autoUpdater.downloadUpdate()
}

/** 내려받은 설치 파일로 앱을 다시 시작한다. 사용자가 눌렀을 때만 부른다 */
export const installUpdate = () => {
  autoUpdater.quitAndInstall()
}
