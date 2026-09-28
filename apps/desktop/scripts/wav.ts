import { readFile, writeFile } from 'node:fs/promises'

export const SAMPLE_RATE_HZ = 16000
export const BITS_PER_SAMPLE = 16
export const CHANNELS = 1

const WAV_HEADER_BYTES = 44
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8
const PCM_FORMAT_TAG = 1

/** RIFF/WAVE 헤더(44바이트). dataBytes는 PCM 본문 길이. */
export const buildWavHeader = ({ dataBytes }: { dataBytes: number }) => {
  const header = Buffer.alloc(WAV_HEADER_BYTES)
  const byteRate = SAMPLE_RATE_HZ * CHANNELS * BYTES_PER_SAMPLE

  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(WAV_HEADER_BYTES - 8 + dataBytes, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(PCM_FORMAT_TAG, 20)
  header.writeUInt16LE(CHANNELS, 22)
  header.writeUInt32LE(SAMPLE_RATE_HZ, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(CHANNELS * BYTES_PER_SAMPLE, 32)
  header.writeUInt16LE(BITS_PER_SAMPLE, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataBytes, 40)

  return header
}

/** 16kHz mono 16bit WAV의 PCM 본문만 읽는다 (헤더 크기 고정 가정). */
export const readPcm = async (filePath: string) => {
  const buffer = await readFile(filePath)
  return buffer.subarray(WAV_HEADER_BYTES)
}

export const writeWav = async ({ filePath, pcm }: { filePath: string; pcm: Buffer }) => {
  await writeFile(filePath, Buffer.concat([buildWavHeader({ dataBytes: pcm.length }), pcm]))
}

export const silencePcm = ({ seconds }: { seconds: number }) =>
  Buffer.alloc(Math.round(seconds * SAMPLE_RATE_HZ) * BYTES_PER_SAMPLE)

export const durationSecOf = ({ pcmBytes }: { pcmBytes: number }) =>
  pcmBytes / (SAMPLE_RATE_HZ * BYTES_PER_SAMPLE)

/**
 * 선형 보간 리샘플로 재생 속도와 함께 음높이를 바꾼다.
 * macOS에 설치된 한국어 음성이 하나뿐이라, 합성 픽스처에서 화자를 구분하려고 쓴다.
 * ratio > 1이면 높고 빠른 목소리, < 1이면 낮고 느린 목소리가 된다.
 */
export const pitchShiftPcm = ({ pcm, ratio }: { pcm: Buffer; ratio: number }) => {
  if (ratio === 1) return pcm

  const inputSamples = Math.floor(pcm.length / BYTES_PER_SAMPLE)
  const outputSamples = Math.floor(inputSamples / ratio)
  const output = Buffer.alloc(outputSamples * BYTES_PER_SAMPLE)

  for (let i = 0; i < outputSamples; i += 1) {
    const source = i * ratio
    const left = Math.floor(source)
    const right = Math.min(left + 1, inputSamples - 1)
    const weight = source - left
    const value =
      pcm.readInt16LE(left * BYTES_PER_SAMPLE) * (1 - weight) +
      pcm.readInt16LE(right * BYTES_PER_SAMPLE) * weight
    output.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value))), i * BYTES_PER_SAMPLE)
  }

  return output
}
