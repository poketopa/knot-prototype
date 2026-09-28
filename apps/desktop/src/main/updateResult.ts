/** `autoUpdater.checkForUpdates()` 결과 중 판정에 필요한 부분만 본다 */
interface UpdateCheckOutcome {
  isUpdateAvailable: boolean
  updateInfo: { version: string }
}

/**
 * 결과에서 사용자에게 알릴 새 버전을 고른다. 업데이트가 없어도 결과 객체는 오고
 * `updateInfo.version`에는 **서버의 최신 버전**(= 지금 쓰고 있는 버전일 수 있다)이 들어 있다.
 * `isUpdateAvailable`을 보지 않으면 자기 버전을 새 버전으로 알리게 되고, 그 상태에서 누른 "받기"는
 * electron-updater가 내부 상태를 채우지 않아 `Please check update first`로 거절된다
 * (`references/distribution.md` 7절).
 */
export const pickAvailableVersion = (result: UpdateCheckOutcome | null) => {
  if (!result?.isUpdateAvailable) return null

  return result.updateInfo.version
}
