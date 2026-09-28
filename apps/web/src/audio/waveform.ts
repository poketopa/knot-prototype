/** 파형 그리기용 구간별 최대 진폭. 71분을 전부 그릴 수 없으니 버킷으로 줄인다 */

interface BuildWaveformPeaksParams {
  samples: Float32Array
  bucketCount: number
}

export const buildWaveformPeaks = ({ samples, bucketCount }: BuildWaveformPeaksParams) => {
  const peaks = new Float32Array(bucketCount)
  if (samples.length === 0) return peaks

  const bucketSamples = Math.max(1, Math.floor(samples.length / bucketCount))

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = bucket * bucketSamples
    const end = Math.min(start + bucketSamples, samples.length)
    let peak = 0
    for (let i = start; i < end; i += 1) {
      const magnitude = Math.abs(samples[i])
      if (magnitude > peak) peak = magnitude
    }
    peaks[bucket] = peak
  }

  return peaks
}
