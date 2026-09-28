import { describe, expect, it } from 'vitest'

import type { MeetingRecord } from '../../types/meeting'
import { filterMeetings } from './filterMeetings'

const meeting = (overrides: Partial<MeetingRecord>): MeetingRecord => ({
  id: 'm1',
  title: '주간 제품 회의',
  createdAt: 0,
  durationSec: 60,
  speakerCount: 2,
  status: 'done',
  audio: new Blob(),
  audioName: 'a.wav',
  utterances: [],
  speakerNames: {},
  processing: null,
  errorMessage: null,
  ...overrides
})

describe('filterMeetings', () => {
  it('빈 질의는 전부 돌려주고 조각은 없다', () => {
    const result = filterMeetings({ meetings: [meeting({})], query: '  ' })

    expect(result).toHaveLength(1)
    expect(result[0].snippet).toBeNull()
  })

  it('제목으로 걸리면 조각 없이 돌려준다', () => {
    const result = filterMeetings({ meetings: [meeting({})], query: '제품' })

    expect(result).toHaveLength(1)
    expect(result[0].snippet).toBeNull()
  })

  it('발화로 걸리면 가장 앞선 발화의 조각을 준다', () => {
    const target = meeting({
      title: '디자인 리뷰',
      utterances: [
        { ord: 0, speakerLabel: 'A', startSec: 0, endSec: 1, text: '시작할게요' },
        { ord: 1, speakerLabel: 'B', startSec: 1, endSec: 2, text: '피드백은 두 가지였어요' },
        { ord: 2, speakerLabel: 'A', startSec: 2, endSec: 3, text: '피드백 고마워요' }
      ]
    })
    const [result] = filterMeetings({ meetings: [target], query: '피드백' })

    expect(result.snippet).toEqual({ before: '', match: '피드백', after: '은 두 가지였어요' })
  })

  it('어디에도 없으면 뺀다', () => {
    expect(filterMeetings({ meetings: [meeting({})], query: '없는말' })).toEqual([])
  })
})
