import { describe, expect, it } from 'vitest'

import { buildSpeechRegions, totalSpeechSec } from './vadSegments'

const WINDOW_SEC = 0.1

/** 0/1 패턴을 확률열로 (0.9 = 발화, 0.05 = 침묵) */
const probabilitiesOf = (pattern: number[]) => pattern.map((value) => (value ? 0.9 : 0.05))

describe('buildSpeechRegions', () => {
  it('발화 구간에 앞뒤 여유를 붙여 돌려준다', () => {
    const pattern = [0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0]
    const regions = buildSpeechRegions({
      probabilities: probabilitiesOf(pattern),
      windowSec: WINDOW_SEC,
      totalSec: pattern.length * WINDOW_SEC
    })

    expect(regions).toHaveLength(1)
    expect(regions[0].start).toBeCloseTo(0.17, 5)
    expect(regions[0].end).toBeCloseTo(0.83, 5)
  })

  it('최소 침묵보다 짧은 끊김은 한 구간으로 둔다', () => {
    const pattern = [1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 0, 0]
    const regions = buildSpeechRegions({
      probabilities: probabilitiesOf(pattern),
      windowSec: WINDOW_SEC,
      totalSec: pattern.length * WINDOW_SEC
    })

    expect(regions).toHaveLength(1)
  })

  it('충분히 긴 침묵은 구간을 나눈다', () => {
    const pattern = [1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0]
    const regions = buildSpeechRegions({
      probabilities: probabilitiesOf(pattern),
      windowSec: WINDOW_SEC,
      totalSec: pattern.length * WINDOW_SEC
    })

    expect(regions).toHaveLength(2)
  })

  it('최소 길이보다 짧은 발화는 버린다', () => {
    const pattern = [0, 1, 0, 0, 0, 0, 0, 0]
    const regions = buildSpeechRegions({
      probabilities: probabilitiesOf(pattern),
      windowSec: WINDOW_SEC,
      totalSec: pattern.length * WINDOW_SEC
    })

    expect(regions).toEqual([])
  })

  it('끝까지 말하고 있으면 전체 길이에서 닫는다', () => {
    const pattern = [0, 0, 1, 1, 1, 1, 1, 1]
    const totalSec = pattern.length * WINDOW_SEC
    const regions = buildSpeechRegions({
      probabilities: probabilitiesOf(pattern),
      windowSec: WINDOW_SEC,
      totalSec
    })

    expect(regions[0].end).toBe(totalSec)
  })

  it('무음뿐이면 빈 배열', () => {
    expect(
      buildSpeechRegions({
        probabilities: probabilitiesOf([0, 0, 0, 0]),
        windowSec: WINDOW_SEC,
        totalSec: 0.4
      })
    ).toEqual([])
  })
})

describe('totalSpeechSec', () => {
  it('구간 길이를 더한다', () => {
    expect(
      totalSpeechSec([
        { start: 0, end: 1.5 },
        { start: 3, end: 4 }
      ])
    ).toBeCloseTo(2.5, 5)
  })
})
