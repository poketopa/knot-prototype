import { describe, expect, it } from 'vitest'
import { formatClock } from './index'

describe('formatClock', () => {
  it('한 시간 미만은 분:초다', () => {
    expect(formatClock({ sec: 767 })).toBe('12:47')
    expect(formatClock({ sec: 0 })).toBe('00:00')
  })

  it('한 시간이 넘으면 시를 붙인다', () => {
    expect(formatClock({ sec: 3723 })).toBe('1:02:03')
  })

  it('소수점은 버리고 음수는 0으로 본다', () => {
    expect(formatClock({ sec: 59.9 })).toBe('00:59')
    expect(formatClock({ sec: -3 })).toBe('00:00')
  })
})
