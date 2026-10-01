/** `autoUpdater.checkForUpdates()` 결과 중 판정에 필요한 부분만 본다 */
interface UpdateCheckOutcome {
  isUpdateAvailable: boolean
  updateInfo: { version: string }
}

const parseVersion = (version: string) => {
  const normalized = version.trim().replace(/^v/i, '')
  const [core, prerelease] = normalized.split('-', 2)
  const coreParts = core.split('.').map((part) => Number(part))

  if (coreParts.length === 0 || coreParts.some((part) => !Number.isInteger(part) || part < 0)) {
    return null
  }

  return {
    coreParts,
    prereleaseParts:
      prerelease?.split(/[.-]/).map((part) => {
        const numeric = Number(part)
        return Number.isInteger(numeric) && String(numeric) === part ? numeric : part
      }) ?? null
  }
}

/** 앱 배포 태그(`0.3.0-preview.11`)처럼 SemVer에 가까운 버전을 비교한다 */
export const compareAppVersions = (left: string, right: string) => {
  const leftParsed = parseVersion(left)
  const rightParsed = parseVersion(right)

  if (!leftParsed || !rightParsed) return left.localeCompare(right, undefined, { numeric: true })

  const coreLength = Math.max(leftParsed.coreParts.length, rightParsed.coreParts.length)
  for (let index = 0; index < coreLength; index += 1) {
    const leftPart = leftParsed.coreParts[index] ?? 0
    const rightPart = rightParsed.coreParts[index] ?? 0
    if (leftPart !== rightPart) return leftPart - rightPart
  }

  if (!leftParsed.prereleaseParts && !rightParsed.prereleaseParts) return 0
  if (!leftParsed.prereleaseParts) return 1
  if (!rightParsed.prereleaseParts) return -1

  const prereleaseLength = Math.max(
    leftParsed.prereleaseParts.length,
    rightParsed.prereleaseParts.length
  )
  for (let index = 0; index < prereleaseLength; index += 1) {
    const leftPart = leftParsed.prereleaseParts[index]
    const rightPart = rightParsed.prereleaseParts[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue

    if (typeof leftPart === 'number' && typeof rightPart === 'number') return leftPart - rightPart
    if (typeof leftPart === 'number') return -1
    if (typeof rightPart === 'number') return 1

    return leftPart.localeCompare(rightPart, undefined, { numeric: true })
  }

  return 0
}

/**
 * 결과에서 사용자에게 알릴 새 버전을 고른다. 업데이트가 없어도 결과 객체는 오고
 * `updateInfo.version`에는 **서버의 최신 버전**(= 지금 쓰고 있는 버전일 수 있다)이 들어 있다.
 * `isUpdateAvailable`을 보지 않으면 자기 버전을 새 버전으로 알리게 되고, 그 상태에서 누른 "받기"는
 * electron-updater가 내부 상태를 채우지 않아 `Please check update first`로 거절된다
 * (`references/distribution.md` 7절).
 */
export const pickAvailableVersion = (
  result: UpdateCheckOutcome | null,
  currentVersion?: string
) => {
  if (!result?.isUpdateAvailable) return null
  if (currentVersion && compareAppVersions(result.updateInfo.version, currentVersion) <= 0)
    return null

  return result.updateInfo.version
}
