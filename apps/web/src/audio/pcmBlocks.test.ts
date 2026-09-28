import { describe, expect, it } from 'vitest'

import { createPcmBlocks } from './pcmBlocks'

const BLOCK_SAMPLES = 4
const INT16_MAX = 32767
const INT16_MIN = -32768

describe('createPcmBlocks', () => {
  it('청크 경계와 블록 경계가 어긋나도 샘플 순서를 유지한다', () => {
    const blocks = createPcmBlocks({ blockSamples: BLOCK_SAMPLES })

    blocks.append(Float32Array.from([1, 1, 1]))
    blocks.append(Float32Array.from([1, 1, 1, 1]))

    expect(blocks.getSampleCount()).toBe(7)
    expect(blocks.toBlocks().map((block) => block.length)).toEqual([4, 3])
    expect([...blocks.toBlocks().flatMap((block) => [...block])]).toEqual(
      new Array(7).fill(INT16_MAX)
    )
  })

  it('블록이 정확히 찼으면 빈 꼬리를 만들지 않는다', () => {
    const blocks = createPcmBlocks({ blockSamples: BLOCK_SAMPLES })

    blocks.append(new Float32Array(BLOCK_SAMPLES))

    expect(blocks.toBlocks()).toHaveLength(1)
  })

  it('±1을 넘는 샘플을 Int16 범위로 자른다', () => {
    const blocks = createPcmBlocks({ blockSamples: BLOCK_SAMPLES })

    blocks.append(Float32Array.from([2, -2, 0.5, -1]))

    expect([...blocks.toBlocks()[0]]).toEqual([INT16_MAX, INT16_MIN, 16384, -INT16_MAX])
  })

  it('아무것도 넣지 않으면 블록이 없다', () => {
    const blocks = createPcmBlocks({ blockSamples: BLOCK_SAMPLES })

    expect(blocks.toBlocks()).toEqual([])
    expect(blocks.getSampleCount()).toBe(0)
  })
})
