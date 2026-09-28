import { describe, expect, it } from 'vitest'
import { recommendWhisperModelId } from './recommend'

const GB = 1024 * 1024 * 1024

describe('recommendWhisperModelId', () => {
  it('메모리와 코어가 넉넉하면 기본 모델을 권장한다', () => {
    expect(recommendWhisperModelId({ cpuCount: 12, totalMemoryBytes: 32 * GB })).toBe('turbo-q5')
  })

  it('메모리가 8GB 미만이면 저사양 모델을 권장한다', () => {
    expect(recommendWhisperModelId({ cpuCount: 12, totalMemoryBytes: 6 * GB })).toBe('small-q5_1')
  })

  it('코어가 4개 이하면 저사양 모델을 권장한다', () => {
    expect(recommendWhisperModelId({ cpuCount: 4, totalMemoryBytes: 32 * GB })).toBe('small-q5_1')
  })

  it('경계값(8GB, 5코어)은 기본 모델을 권장한다', () => {
    expect(recommendWhisperModelId({ cpuCount: 5, totalMemoryBytes: 8 * GB })).toBe('turbo-q5')
  })

  it('고품질 모델은 자동으로 권장하지 않는다', () => {
    const recommended = recommendWhisperModelId({ cpuCount: 24, totalMemoryBytes: 128 * GB })

    expect(recommended).not.toBe('large-v3-q5')
  })
})
