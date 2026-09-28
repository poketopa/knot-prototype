import { describe, expect, it } from 'vitest'
import { formatBytes } from './index'

describe('formatBytes', () => {
  it('1GB 이상은 소수 첫째 자리까지 GB로 보여준다', () => {
    expect(formatBytes({ bytes: 2497281120 })).toBe('2.5GB')
    expect(formatBytes({ bytes: 1081140203 })).toBe('1.1GB')
  })

  it('MB·KB는 정수로 반올림한다', () => {
    expect(formatBytes({ bytes: 574041195 })).toBe('574MB')
    expect(formatBytes({ bytes: 885098 })).toBe('885KB')
  })

  it('1KB 미만은 바이트 그대로 보여준다', () => {
    expect(formatBytes({ bytes: 0 })).toBe('0B')
    expect(formatBytes({ bytes: 512 })).toBe('512B')
  })
})
