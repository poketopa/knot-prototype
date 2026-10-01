import { describe, expect, it } from 'vitest'
import { compareAppVersions, pickAvailableVersion } from './updateResult'

describe('compareAppVersions', () => {
  it('preview 번호를 숫자로 비교한다', () => {
    expect(compareAppVersions('0.3.0-preview.11', '0.3.0-preview.4')).toBeGreaterThan(0)
  })

  it('같은 core에서는 정식 버전을 preview보다 새 버전으로 본다', () => {
    expect(compareAppVersions('0.3.0', '0.3.0-preview.11')).toBeGreaterThan(0)
  })
})

describe('pickAvailableVersion', () => {
  it('업데이트가 있으면 그 버전을 돌려준다', () => {
    expect(
      pickAvailableVersion({ isUpdateAvailable: true, updateInfo: { version: '0.2.0' } })
    ).toBe('0.2.0')
  })

  it('업데이트가 없으면 결과에 버전이 들어 있어도 알리지 않는다', () => {
    expect(
      pickAvailableVersion({ isUpdateAvailable: false, updateInfo: { version: '0.1.1' } })
    ).toBeNull()
  })

  it('확인 결과가 없으면 null을 돌려준다', () => {
    expect(pickAvailableVersion(null)).toBeNull()
  })

  it('업데이트 플래그가 있어도 현재 버전보다 새 버전이 아니면 알리지 않는다', () => {
    expect(
      pickAvailableVersion(
        { isUpdateAvailable: true, updateInfo: { version: '0.3.0-preview.4' } },
        '0.3.0-preview.11'
      )
    ).toBeNull()
    expect(
      pickAvailableVersion(
        { isUpdateAvailable: true, updateInfo: { version: '0.3.0-preview.11' } },
        '0.3.0-preview.11'
      )
    ).toBeNull()
  })
})
