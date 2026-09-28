import { describe, expect, it } from 'vitest'

import { encodeWav, wavDurationSec } from './wav'

const SAMPLE_RATE_HZ = 16000
const WAV_HEADER_BYTES = 44

const asciiAt = ({ view, offset }: { view: DataView; offset: number }) =>
  String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  )

describe('encodeWav', () => {
  it('16kHz mono 16bit PCM 헤더를 쓴다', () => {
    const buffer = encodeWav({
      blocks: [Int16Array.from([1, -1, 2])],
      sampleRate: SAMPLE_RATE_HZ
    })
    const view = new DataView(buffer)

    expect(asciiAt({ view, offset: 0 })).toBe('RIFF')
    expect(asciiAt({ view, offset: 8 })).toBe('WAVE')
    expect(asciiAt({ view, offset: 12 })).toBe('fmt ')
    expect(asciiAt({ view, offset: 36 })).toBe('data')
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(SAMPLE_RATE_HZ)
    expect(view.getUint32(28, true)).toBe(SAMPLE_RATE_HZ * 2)
    expect(view.getUint16(34, true)).toBe(16)
  })

  it('블록을 순서대로 이어 붙이고 길이를 헤더에 적는다', () => {
    const buffer = encodeWav({
      blocks: [Int16Array.from([10, 20]), Int16Array.from([30])],
      sampleRate: SAMPLE_RATE_HZ
    })
    const view = new DataView(buffer)
    const dataBytes = 3 * 2

    expect(buffer.byteLength).toBe(WAV_HEADER_BYTES + dataBytes)
    expect(view.getUint32(40, true)).toBe(dataBytes)
    expect(view.getUint32(4, true)).toBe(WAV_HEADER_BYTES - 8 + dataBytes)
    expect([...new Int16Array(buffer, WAV_HEADER_BYTES, 3)]).toEqual([10, 20, 30])
  })

  it('빈 녹음도 헤더만 있는 WAV가 된다', () => {
    const buffer = encodeWav({ blocks: [], sampleRate: SAMPLE_RATE_HZ })

    expect(buffer.byteLength).toBe(WAV_HEADER_BYTES)
    expect(new DataView(buffer).getUint32(40, true)).toBe(0)
  })
})

describe('wavDurationSec', () => {
  it('샘플 수를 초로 바꾼다', () => {
    expect(wavDurationSec({ sampleCount: SAMPLE_RATE_HZ * 3, sampleRate: SAMPLE_RATE_HZ })).toBe(3)
  })
})
