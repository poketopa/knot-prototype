import { describe, expect, it } from 'vitest'
import { rmsOf } from './audio'

describe('rmsOf', () => {
  it('빈 청크는 0을 반환한다', () => {
    expect(rmsOf(new Float32Array(0))).toBe(0)
  })

  it('무음은 0을 반환한다', () => {
    expect(rmsOf(new Float32Array(8))).toBe(0)
  })

  it('최대 진폭이 이어지면 1을 반환한다', () => {
    expect(rmsOf(new Float32Array([1, -1, 1, -1]))).toBe(1)
  })

  it('부호와 무관하게 크기만 반영한다', () => {
    expect(rmsOf(new Float32Array([-0.5, 0.5]))).toBeCloseTo(0.5, 6)
  })

  it('절반이 무음이면 RMS가 √2로 나뉜다', () => {
    expect(rmsOf(new Float32Array([1, 0]))).toBeCloseTo(Math.SQRT1_2, 6)
  })
})
