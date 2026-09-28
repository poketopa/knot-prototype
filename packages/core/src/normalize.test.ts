import { describe, expect, it } from 'vitest'
import { frameSamplesOf, gainDbFor, gainOf, speechRmsDbOf, toDb } from './normalize'

describe('frameSamplesOf', () => {
  it('16kHz에서 50ms는 800샘플이다', () => {
    expect(frameSamplesOf({ sampleRate: 16000 })).toBe(800)
  })

  it('샘플레이트가 아무리 낮아도 최소 1샘플은 센다', () => {
    expect(frameSamplesOf({ sampleRate: 1 })).toBe(1)
  })
})

describe('speechRmsDbOf', () => {
  it('프레임이 없으면 -Infinity를 준다', () => {
    expect(speechRmsDbOf({ frameRms: [] })).toBe(-Infinity)
  })

  it('무음 프레임이 섞여 있어도 큰 쪽 90퍼센타일을 발화 음량으로 본다', () => {
    const frameRms = [...Array(9).fill(0.0001), 0.1]

    expect(speechRmsDbOf({ frameRms })).toBeCloseTo(toDb(0.1), 5)
  })

  it('프레임이 하나면 그 값을 쓴다', () => {
    expect(speechRmsDbOf({ frameRms: [0.5] })).toBeCloseTo(toDb(0.5), 5)
  })
})

describe('gainDbFor', () => {
  it('목표치(-20 dBFS)까지 올릴 게인을 준다', () => {
    expect(gainDbFor(-30)).toBeCloseTo(10, 5)
  })

  it('이미 목표치보다 크면 음수 게인으로 내린다', () => {
    expect(gainDbFor(-10)).toBeCloseTo(-10, 5)
  })

  it('상한은 +30dB이다 — 더 작은 소리는 잡음만 커진다', () => {
    expect(gainDbFor(-80)).toBe(30)
  })

  it('무음(-Infinity)에는 게인을 주지 않는다', () => {
    expect(gainDbFor(-Infinity)).toBe(0)
  })
})

describe('gainOf', () => {
  it('0dB는 배수 1이다', () => {
    expect(gainOf(0)).toBeCloseTo(1, 10)
  })

  it('+20dB는 배수 10이다', () => {
    expect(gainOf(20)).toBeCloseTo(10, 10)
  })
})
