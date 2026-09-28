import { describe, expect, it } from 'vitest'

import { planThreads } from './threads'

describe('planThreads', () => {
  it('화자 분리에 성능 코어를 전부 주고 GPU를 쓰는 단계는 낮게 잡는다', () => {
    expect(planThreads({ performanceCores: 6 })).toEqual({ stt: 4, diarize: 6, summary: 2 })
  })

  it('성능 코어가 적으면 상한이 아니라 코어 수를 따른다', () => {
    expect(planThreads({ performanceCores: 1 })).toEqual({ stt: 1, diarize: 1, summary: 1 })
  })

  it('코어 수를 못 구해도 최소 1은 보장한다', () => {
    expect(planThreads({ performanceCores: 0 })).toEqual({ stt: 1, diarize: 1, summary: 1 })
  })

  it('조용히 처리하면 화자 분리만 성능 코어의 절반으로 줄인다', () => {
    expect(planThreads({ performanceCores: 6, isQuiet: true })).toEqual({
      stt: 4,
      diarize: 3,
      summary: 2
    })
  })

  it('조용히 처리해도 코어 수가 홀수면 올림하고 1 아래로 내려가지 않는다', () => {
    expect(planThreads({ performanceCores: 5, isQuiet: true }).diarize).toBe(3)
    expect(planThreads({ performanceCores: 1, isQuiet: true }).diarize).toBe(1)
    expect(planThreads({ performanceCores: 0, isQuiet: true }).diarize).toBe(1)
  })
})
