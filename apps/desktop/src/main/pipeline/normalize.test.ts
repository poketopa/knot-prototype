import { describe, expect, it } from 'vitest'

import { gainDbFor } from '@meeting-stt/core/normalize'

import { applyGain, measureSpeechRmsDb, normalizeWavBuffer, readWavPcm } from './normalize'

const SAMPLE_RATE_HZ = 16000
const INT16_MAX = 32767

/** 지정한 청크 순서로 16bit mono WAV 버퍼를 만든다 */
const buildWav = ({ pcm, extraChunk }: { pcm: Int16Array; extraChunk?: Buffer }) => {
  const fmt = Buffer.alloc(24)
  fmt.write('fmt ', 0, 'ascii')
  fmt.writeUInt32LE(16, 4)
  fmt.writeUInt16LE(1, 8)
  fmt.writeUInt16LE(1, 10)
  fmt.writeUInt32LE(SAMPLE_RATE_HZ, 12)
  fmt.writeUInt32LE(SAMPLE_RATE_HZ * 2, 16)
  fmt.writeUInt16LE(2, 20)
  fmt.writeUInt16LE(16, 22)

  const body = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.length * 2)
  const data = Buffer.alloc(8)
  data.write('data', 0, 'ascii')
  data.writeUInt32LE(body.length, 4)

  const chunks = [fmt, ...(extraChunk ? [extraChunk] : []), data, body]
  const riff = Buffer.alloc(12)
  riff.write('RIFF', 0, 'ascii')
  riff.writeUInt32LE(4 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4)
  riff.write('WAVE', 8, 'ascii')

  return Buffer.concat([riff, ...chunks])
}

const listChunk = () => {
  const chunk = Buffer.alloc(8 + 10)
  chunk.write('LIST', 0, 'ascii')
  chunk.writeUInt32LE(10, 4)
  return chunk
}

/** 진폭이 일정한 사인파 PCM (초 단위 길이) */
const sinePcm = ({ amplitude, seconds }: { amplitude: number; seconds: number }) => {
  const pcm = new Int16Array(SAMPLE_RATE_HZ * seconds)
  for (let i = 0; i < pcm.length; i += 1) {
    pcm[i] = Math.round(amplitude * INT16_MAX * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE_HZ))
  }
  return pcm
}

describe('readWavPcm', () => {
  it('44바이트 헤더 WAV에서 샘플레이트와 PCM을 읽는다', () => {
    const pcm = Int16Array.from([1, -2, 3])

    const parsed = readWavPcm(buildWav({ pcm }))

    expect(parsed.headerBytes).toBe(44)
    expect(parsed.sampleRate).toBe(SAMPLE_RATE_HZ)
    expect([...parsed.pcm]).toEqual([1, -2, 3])
  })

  it('LIST 청크가 끼어 있어도 data 청크를 찾는다', () => {
    const pcm = Int16Array.from([7, 8])

    const parsed = readWavPcm(buildWav({ pcm, extraChunk: listChunk() }))

    expect(parsed.headerBytes).toBe(44 + 18)
    expect([...parsed.pcm]).toEqual([7, 8])
  })

  it('16bit PCM이 아니면 거부한다', () => {
    const wav = buildWav({ pcm: Int16Array.from([0]) })
    wav.writeUInt16LE(3, 20)

    expect(() => readWavPcm(wav)).toThrow('16bit PCM')
  })
})

describe('measureSpeechRmsDb · gainDbFor', () => {
  it('일정한 사인파의 RMS를 dBFS로 잰다', () => {
    const pcm = sinePcm({ amplitude: 0.1, seconds: 1 })

    const rmsDb = measureSpeechRmsDb({ pcm, sampleRate: SAMPLE_RATE_HZ })

    // 진폭 0.1 사인파의 RMS = 0.1/√2 ≈ -23 dBFS
    expect(rmsDb).toBeCloseTo(-23, 0)
  })

  it('무음이면 게인을 주지 않는다', () => {
    const pcm = new Int16Array(SAMPLE_RATE_HZ)

    expect(gainDbFor(measureSpeechRmsDb({ pcm, sampleRate: SAMPLE_RATE_HZ }))).toBe(0)
  })

  it('작은 소리는 목표까지 올릴 게인을 준다 (상한·경계는 core의 단위 테스트)', () => {
    const pcm = sinePcm({ amplitude: 0.01, seconds: 1 })

    expect(gainDbFor(measureSpeechRmsDb({ pcm, sampleRate: SAMPLE_RATE_HZ }))).toBeGreaterThan(20)
  })
})

describe('applyGain', () => {
  it('게인을 적용하고 범위를 넘는 샘플은 클립한다', () => {
    const { pcm, clippedCount } = applyGain({
      pcm: Int16Array.from([1000, -1000, 30000]),
      gainDb: 6
    })

    expect(pcm[0]).toBe(1995)
    expect(pcm[1]).toBe(-1995)
    expect(pcm[2]).toBe(INT16_MAX)
    expect(clippedCount).toBe(1)
  })
})

describe('normalizeWavBuffer', () => {
  it('작은 음량의 WAV를 목표 음량으로 올리고 헤더는 보존한다', () => {
    const input = buildWav({
      pcm: sinePcm({ amplitude: 0.01, seconds: 1 }),
      extraChunk: listChunk()
    })

    const { buffer, result } = normalizeWavBuffer(input)

    expect(buffer.subarray(0, 62).equals(input.subarray(0, 62))).toBe(true)
    expect(buffer.length).toBe(input.length)
    expect(result.gainDb).toBeGreaterThan(20)
    expect(measureSpeechRmsDb({ ...readWavPcm(buffer) })).toBeCloseTo(-20, 0)
    expect(result.clippedRatio).toBe(0)
  })
})
