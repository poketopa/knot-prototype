/**
 * 녹음 중인 PCM을 Int16 블록으로 쌓아 둔다.
 *
 * Float32로 들고 있으면 71분이 273MB지만 Int16이면 절반이고, 값은 데스크탑이 쓰는
 * 16bit PCM WAV와 같다 (`src/main/audio/wavWriter.ts`의 `float32ToInt16`과 같은 변환).
 * 워크릿 청크(수천 샘플)를 그대로 배열에 밀어 넣으면 71분에 조각이 30만 개가 되므로
 * 고정 길이 블록에 채워 넣어 조각 수를 녹음 길이에 비례한 수백 개로 묶는다.
 */

const INT16_MAX = 32767
const INT16_MIN = -32768

/** 블록 하나에 담는 샘플 수. 16kHz에서 10초 = 320KB */
export const DEFAULT_BLOCK_SAMPLES = 160000

const toInt16 = (sample: number) =>
  Math.max(INT16_MIN, Math.min(INT16_MAX, Math.round(sample * INT16_MAX)))

interface CreatePcmBlocksParams {
  blockSamples?: number
}

export const createPcmBlocks = ({
  blockSamples = DEFAULT_BLOCK_SAMPLES
}: CreatePcmBlocksParams = {}) => {
  const filled: Int16Array[] = []
  let current = new Int16Array(blockSamples)
  let offset = 0
  let sampleCount = 0

  const append = (samples: Float32Array) => {
    for (let i = 0; i < samples.length; i += 1) {
      current[offset] = toInt16(samples[i])
      offset += 1

      if (offset === blockSamples) {
        filled.push(current)
        current = new Int16Array(blockSamples)
        offset = 0
      }
    }
    sampleCount += samples.length
  }

  /** 지금까지 쌓인 블록. 마지막 블록은 채워진 만큼만 잘라서 준다 */
  const toBlocks = () => (offset === 0 ? [...filled] : [...filled, current.subarray(0, offset)])

  return { append, toBlocks, getSampleCount: () => sampleCount }
}

export type PcmBlocks = ReturnType<typeof createPcmBlocks>
