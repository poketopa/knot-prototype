import { describe, expect, it } from 'vitest'
import { formatMeetingDate, formatMeetingDay, formatMeetingTime } from './index'

describe('formatMeetingTime', () => {
  it('오후 시각을 12시간제로 읽는다', () => {
    expect(formatMeetingTime({ epochMs: new Date(2026, 8, 24, 14, 10).getTime() })).toBe(
      '오후 2:10'
    )
  })

  it('자정은 오전 12시, 정오는 오후 12시다', () => {
    expect(formatMeetingTime({ epochMs: new Date(2026, 8, 24, 0, 5).getTime() })).toBe('오전 12:05')
    expect(formatMeetingTime({ epochMs: new Date(2026, 8, 24, 12, 0).getTime() })).toBe(
      '오후 12:00'
    )
  })
})

describe('formatMeetingDate', () => {
  it('날짜·요일·시각을 조립한다', () => {
    expect(formatMeetingDate({ epochMs: new Date(2026, 8, 24, 14, 10).getTime() })).toBe(
      '2026년 9월 24일 (목) 오후 2:10'
    )
  })
})

describe('formatMeetingDay', () => {
  const now = new Date(2026, 8, 24, 15, 0).getTime()

  it('올해면 연도를 생략한다', () => {
    expect(formatMeetingDay({ epochMs: new Date(2026, 8, 22, 9, 0).getTime(), now })).toBe(
      '9월 22일'
    )
  })

  it('다른 해면 연도를 붙인다', () => {
    expect(formatMeetingDay({ epochMs: new Date(2025, 11, 30, 9, 0).getTime(), now })).toBe(
      '2025년 12월 30일'
    )
  })
})
