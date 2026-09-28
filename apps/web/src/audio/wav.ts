/**
 * Int16 블록 → 16bit mono PCM WAV.
 * 데스크탑의 `src/main/audio/wavWriter.ts`와 같은 44바이트 RIFF/WAVE 헤더를 만든다.
 * 블록을 한 번 이어 붙인 다음 헤더를 붙이면 큰 배열이 두 번 생기므로,
 * 헤더 + 본문 크기의 버퍼를 한 번만 잡고 블록을 그 안에 바로 쓴다.
 */

import { BITS_PER_SAMPLE, CHANNELS } from '@meeting-stt/core/audio'

const WAV_HEADER_BYTES = 44
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8
const PCM_FORMAT_TAG = 1
const RIFF_SIZE_OFFSET = 8

const writeAscii = ({ view, offset, text }: { view: DataView; offset: number; text: string }) => {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
}

interface EncodeWavParams {
  blocks: Int16Array[]
  sampleRate: number
}

/** WAV 한 개의 바이트열. `Blob`/`File`로 감싸 내려받거나 다시 디코딩하면 된다 */
export const encodeWav = ({ blocks, sampleRate }: EncodeWavParams) => {
  const sampleCount = blocks.reduce((total, block) => total + block.length, 0)
  const dataBytes = sampleCount * BYTES_PER_SAMPLE
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes)
  const view = new DataView(buffer)
  const byteRate = sampleRate * CHANNELS * BYTES_PER_SAMPLE

  writeAscii({ view, offset: 0, text: 'RIFF' })
  view.setUint32(4, WAV_HEADER_BYTES - RIFF_SIZE_OFFSET + dataBytes, true)
  writeAscii({ view, offset: 8, text: 'WAVE' })
  writeAscii({ view, offset: 12, text: 'fmt ' })
  view.setUint32(16, 16, true)
  view.setUint16(20, PCM_FORMAT_TAG, true)
  view.setUint16(22, CHANNELS, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, CHANNELS * BYTES_PER_SAMPLE, true)
  view.setUint16(34, BITS_PER_SAMPLE, true)
  writeAscii({ view, offset: 36, text: 'data' })
  view.setUint32(40, dataBytes, true)

  // 헤더가 44바이트(짝수)라 Int16Array 뷰를 그 뒤에 바로 얹을 수 있다
  const pcm = new Int16Array(buffer, WAV_HEADER_BYTES, sampleCount)
  let offset = 0
  for (const block of blocks) {
    pcm.set(block, offset)
    offset += block.length
  }

  return buffer
}

export const wavDurationSec = ({
  sampleCount,
  sampleRate
}: {
  sampleCount: number
  sampleRate: number
}) => (sampleRate === 0 ? 0 : sampleCount / sampleRate)
