import { describe, expect, it } from 'vitest'

import { buildWaveformPeaks } from './waveform'

describe('buildWaveformPeaks', () => {
  it('버킷마다 최대 진폭을 뽑는다', () => {
    const samples = Float32Array.from([0.1, -0.9, 0.2, 0.3, -0.4, 0.5])
    expect(Array.from(buildWaveformPeaks({ samples, bucketCount: 3 }))).toEqual([
      0.8999999761581421, 0.30000001192092896, 0.5
    ])
  })

  it('샘플이 없으면 전부 0', () => {
    expect(
      Array.from(buildWaveformPeaks({ samples: new Float32Array(0), bucketCount: 2 }))
    ).toEqual([0, 0])
  })
})
