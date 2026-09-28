import type { SetShortcutsSuspendedRequest, UpdateSettingsRequest } from '@shared/ipc'

/**
 * @description 앱 설정을 불러옵니다.
 * @returns 현재 설정
 * @example
 * const settings = await getSettingsApi()
 */
export const getSettingsApi = async () => window.api.settings.get()

/**
 * @description 앱 설정을 저장합니다. 설정 전체를 한 번에 보냅니다.
 * 단축키가 바뀌면 main이 등록을 먼저 시도하고, 실패하면 저장하지 않고 reject합니다.
 * @param isAudioKept - 회의록을 만든 뒤 원본 녹음을 보관할지 여부
 * @param isUpdateCheckEnabled - 앱 시작 시 새 버전을 확인할지 여부 (기본 꺼짐)
 * @param recordingShortcut - 녹음 토글 전역 단축키 (Electron accelerator)
 * @returns 저장된 설정
 * @example
 * const settings = await updateSettingsApi({
 *   isAudioKept: true,
 *   isUpdateCheckEnabled: false,
 *   recordingShortcut: 'Alt+Command+R'
 * })
 */
export const updateSettingsApi = async ({
  isAudioKept,
  isUpdateCheckEnabled,
  recordingShortcut
}: UpdateSettingsRequest) =>
  window.api.settings.update({
    isAudioKept,
    isUpdateCheckEnabled,
    recordingShortcut
  })

/**
 * @description 새 단축키를 입력받는 동안 전역 단축키를 해제하거나, 끝난 뒤 다시 등록합니다.
 * 해제하지 않으면 현재 단축키를 누르는 순간 녹음이 시작됩니다.
 * @param isSuspended - true면 해제, false면 저장된 단축키로 다시 등록
 * @returns 없음
 * @example
 * await setShortcutsSuspendedApi({ isSuspended: true })
 */
export const setShortcutsSuspendedApi = async ({ isSuspended }: SetShortcutsSuspendedRequest) => {
  await window.api.shortcuts.setSuspended({ isSuspended })
}
