import { describe, expect, it } from 'vitest'

import {
  buildSpeechBatches,
  buildSpeechTimeline,
  concatSpeechSamples,
  restoreTime,
  toSpeechSlices
} from './speechTimeline'

const SAMPLE_RATE = 100

const slices = toSpeechSlices({
  regions: [
    { start: 1, end: 2 },
    { start: 5, end: 7 }
  ],
  sampleRate: SAMPLE_RATE,
  sampleCount: 1000
})

describe('toSpeechSlices', () => {
  it('초를 샘플 인덱스로 바꾼다', () => {
    expect(slices).toEqual([
      { startSample: 100, endSample: 200 },
      { startSample: 500, endSample: 700 }
    ])
  })

  it('오디오 끝을 넘는 구간은 잘라내고 빈 구간은 버린다', () => {
    expect(
      toSpeechSlices({
        regions: [{ start: 9, end: 20 }],
        sampleRate: SAMPLE_RATE,
        sampleCount: 1000
      })
    ).toEqual([{ startSample: 900, endSample: 1000 }])
    expect(
      toSpeechSlices({
        regions: [{ start: 12, end: 20 }],
        sampleRate: SAMPLE_RATE,
        sampleCount: 1000
      })
    ).toEqual([])
  })
})

describe('restoreTime', () => {
  const timeline = buildSpeechTimeline({ slices, sampleRate: SAMPLE_RATE })

  it('잘라낸 오디오 시각을 원본 시각으로 되돌린다', () => {
    expect(timeline).toEqual([
      { compressedStart: 0, originalStart: 1, durationSec: 1 },
      { compressedStart: 1, originalStart: 5, durationSec: 2 }
    ])
    expect(restoreTime({ timeline, compressedSec: 0 })).toBe(1)
    expect(restoreTime({ timeline, compressedSec: 0.5 })).toBe(1.5)
    expect(restoreTime({ timeline, compressedSec: 1 })).toBe(5)
    expect(restoreTime({ timeline, compressedSec: 2.5 })).toBe(6.5)
  })

  it('마지막 구간을 넘는 시각은 그 구간의 끝으로 묶는다', () => {
    expect(restoreTime({ timeline, compressedSec: 99 })).toBe(7)
  })

  it('구간이 없으면 그대로 돌려준다', () => {
    expect(restoreTime({ timeline: [], compressedSec: 4 })).toBe(4)
  })
})

describe('concatSpeechSamples', () => {
  it('발화 구간만 이어 붙인다', () => {
    const samples = Float32Array.from({ length: 10 }, (_, i) => i)
    const concatenated = concatSpeechSamples({
      samples,
      slices: [
        { startSample: 1, endSample: 3 },
        { startSample: 6, endSample: 8 }
      ]
    })

    expect(Array.from(concatenated)).toEqual([1, 2, 6, 7])
  })
})

describe('buildSpeechBatches', () => {
  it('배치 하나가 최대 길이를 넘지 않게 나눈다', () => {
    const batches = buildSpeechBatches({
      slices: [
        { startSample: 0, endSample: 100 },
        { startSample: 200, endSample: 300 },
        { startSample: 400, endSample: 500 }
      ],
      sampleRate: SAMPLE_RATE,
      maxSpeechSec: 1.5
    })

    expect(batches).toEqual([
      { fromIndex: 0, toIndex: 1 },
      { fromIndex: 1, toIndex: 2 },
      { fromIndex: 2, toIndex: 3 }
    ])
  })

  it('최대 길이보다 긴 구간 하나는 혼자 배치가 된다', () => {
    expect(
      buildSpeechBatches({
        slices: [{ startSample: 0, endSample: 1000 }],
        sampleRate: SAMPLE_RATE,
        maxSpeechSec: 1
      })
    ).toEqual([{ fromIndex: 0, toIndex: 1 }])
  })

  it('구간이 없으면 배치도 없다', () => {
    expect(buildSpeechBatches({ slices: [], sampleRate: SAMPLE_RATE, maxSpeechSec: 1 })).toEqual([])
  })
})
