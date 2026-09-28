import { describe, expect, it } from 'vitest'
import { formatDuration, formatDurationShort } from './index'

describe('formatDuration', () => {
  it('시·분·초를 모두 표시한다', () => {
    expect(formatDuration({ sec: 3723 })).toBe('1시간 2분 3초')
  })

  it('값이 0인 단위는 생략한다', () => {
    expect(formatDuration({ sec: 3600 })).toBe('1시간')
    expect(formatDuration({ sec: 125 })).toBe('2분 5초')
  })

  it('0초 녹음은 "0초"로 표시한다', () => {
    expect(formatDuration({ sec: 0 })).toBe('0초')
  })

  it('소수점 길이는 초 단위로 반올림한다', () => {
    expect(formatDuration({ sec: 61.6 })).toBe('1분 2초')
  })

  it('음수는 0초로 취급한다', () => {
    expect(formatDuration({ sec: -5 })).toBe('0초')
  })
})

describe('formatDurationShort', () => {
  it('1분이 넘으면 초를 버린다', () => {
    expect(formatDurationShort({ sec: 48 * 60 + 12 })).toBe('48분')
    expect(formatDurationShort({ sec: 72 * 60 + 30 })).toBe('1시간 12분')
  })

  it('정각 시간은 분을 생략한다', () => {
    expect(formatDurationShort({ sec: 3600 })).toBe('1시간')
  })

  it('1분 미만은 초로 보여 준다', () => {
    expect(formatDurationShort({ sec: 42 })).toBe('42초')
    expect(formatDurationShort({ sec: 0 })).toBe('0초')
  })
})
