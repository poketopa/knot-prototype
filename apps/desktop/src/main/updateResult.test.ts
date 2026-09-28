import { describe, expect, it } from 'vitest'
import { pickAvailableVersion } from './updateResult'

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
})
