/** 파일 → 디코딩 → 정규화 → 파형. S1 단계가 화면에 필요로 하는 것을 한 번에 만든다 */

import { decodeAudioFile } from '../audio/decodeAudio'
import { buildWaveformPeaks } from '../audio/waveform'
import { normalizeSamples, type NormalizeResult } from './normalize'

const WAVEFORM_BUCKETS = 900

export interface LoadedAudio {
  fileName: string
  samples: Float32Array
  sampleRate: number
  durationSec: number
  sourceChannelCount: number
  normalize: NormalizeResult
  peaks: Float32Array
  decodeMs: number
}

export const loadAudio = async (file: File): Promise<LoadedAudio> => {
  const startedAt = performance.now()
  const decoded = await decodeAudioFile(file)
  const normalize = normalizeSamples({ samples: decoded.samples, sampleRate: decoded.sampleRate })

  return {
    fileName: file.name,
    ...decoded,
    normalize,
    peaks: buildWaveformPeaks({ samples: decoded.samples, bucketCount: WAVEFORM_BUCKETS }),
    decodeMs: performance.now() - startedAt
  }
}
