import { describe, expect, it } from 'vitest'

import { decodePowerset } from './powerset'

const FRAME_SEC = 0.1

/** 클래스 인덱스 목록을 원-핫 로짓으로 바꾼다 */
const framesOf = (classIds: number[]) =>
  classIds.map((id) => Array.from({ length: 7 }, (_, i) => (i === id ? 1 : 0)))

describe('decodePowerset', () => {
  it('혼자 말하는 구간을 화자별로 뽑는다', () => {
    const segments = decodePowerset({
      frameScores: framesOf([0, 0, 1, 1, 1, 1, 1, 0, 0, 2, 2, 2, 2, 2]),
      frameSec: FRAME_SEC,
      minSegmentSec: 0.2
    })

    expect(segments).toEqual([
      { localSpeaker: 0, start: 0.2, end: expect.closeTo(0.7, 5) },
      { localSpeaker: 1, start: expect.closeTo(0.9, 5), end: expect.closeTo(1.4, 5) }
    ])
  })

  it('동시 발화 클래스는 두 화자에게 모두 넣는다', () => {
    const segments = decodePowerset({
      frameScores: framesOf([4, 4, 4, 4, 4]),
      frameSec: FRAME_SEC,
      minSegmentSec: 0.2
    })

    expect(segments.map((segment) => segment.localSpeaker)).toEqual([0, 1])
    expect(segments.every((segment) => segment.start === 0 && segment.end === 0.5)).toBe(true)
  })

  it('짧은 공백은 한 구간으로 잇는다', () => {
    const segments = decodePowerset({
      frameScores: framesOf([1, 1, 1, 0, 1, 1, 1]),
      frameSec: FRAME_SEC,
      minSegmentSec: 0.2
    })

    expect(segments).toHaveLength(1)
    expect(segments[0].end).toBeCloseTo(0.7, 5)
  })

  it('최소 길이보다 짧은 구간은 버린다', () => {
    const segments = decodePowerset({
      frameScores: framesOf([1, 0, 0, 0, 0, 0, 0, 0]),
      frameSec: FRAME_SEC,
      minSegmentSec: 0.5
    })

    expect(segments).toEqual([])
  })
})
