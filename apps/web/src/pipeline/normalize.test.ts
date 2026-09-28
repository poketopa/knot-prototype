import { describe, expect, it } from 'vitest'

import { measureSpeechRmsDb, normalizeSamples } from './normalize'

const SAMPLE_RATE = 16000

/** 진폭이 일정한 사인파. RMS는 amplitude / sqrt(2)로 계산된다 */
const sine = ({ amplitude, seconds }: { amplitude: number; seconds: number }) => {
  const samples = new Float32Array(SAMPLE_RATE * seconds)
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = amplitude * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE)
  }
  return samples
}

describe('measureSpeechRmsDb', () => {
  it('사인파의 RMS를 dBFS로 잰다', () => {
    const measured = measureSpeechRmsDb({
      samples: sine({ amplitude: 0.5, seconds: 1 }),
      sampleRate: SAMPLE_RATE
    })
    expect(measured).toBeCloseTo(20 * Math.log10(0.5 / Math.SQRT2), 1)
  })

  it('프레임 하나도 채우지 못하면 -Infinity', () => {
    expect(measureSpeechRmsDb({ samples: new Float32Array(10), sampleRate: SAMPLE_RATE })).toBe(
      -Infinity
    )
  })
})

describe('normalizeSamples', () => {
  it('작은 소리를 목표 음량 근처로 끌어올린다', () => {
    const samples = sine({ amplitude: 0.01, seconds: 1 })
    const result = normalizeSamples({ samples, sampleRate: SAMPLE_RATE })

    expect(result.gainDb).toBeGreaterThan(0)
    expect(result.normalizedSpeechRmsDb).toBeCloseTo(result.speechRmsDb + result.gainDb, 5)
    expect(result.clippedRatio).toBe(0)
  })

  it('이미 큰 소리는 게인이 음수라 클리핑되지 않는다', () => {
    const samples = sine({ amplitude: 0.9, seconds: 1 })
    const result = normalizeSamples({ samples, sampleRate: SAMPLE_RATE })

    expect(result.gainDb).toBeLessThan(0)
    expect(result.clippedRatio).toBe(0)
  })
})
