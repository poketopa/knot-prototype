// Electron은 main에서 던진 에러를 "Error invoking remote method '<채널>': Error: <원문>"으로 감싼다
const REMOTE_ERROR_PREFIX = /^Error invoking remote method '[^']+': (?:Error: )?/

const stripRemotePrefix = (caught: unknown) =>
  caught instanceof Error ? caught.message.replace(REMOTE_ERROR_PREFIX, '') : String(caught)

/**
 * @description 설정 여부와 무관하게 지금 새 버전이 있는지 확인합니다. 실패하면 안내 문구로 reject됩니다.
 * @returns 지금 버전과 새 버전(없으면 null)
 * @example
 * const { currentVersion, availableVersion } = await checkUpdateApi()
 */
export const checkUpdateApi = async () => {
  try {
    return await window.api.update.check()
  } catch (caught) {
    throw new Error(stripRemotePrefix(caught))
  }
}

/**
 * @description 발견한 새 버전을 내려받습니다. 다 받을 때까지 resolve되지 않습니다.
 * @returns 없음
 * @example
 * await downloadUpdateApi()
 */
export const downloadUpdateApi = async () => {
  await window.api.update.download()
}

/**
 * @description 내려받은 새 버전을 설치하며 앱을 다시 시작합니다.
 * @returns 없음
 * @example
 * await installUpdateApi()
 */
export const installUpdateApi = async () => {
  await window.api.update.install()
}
