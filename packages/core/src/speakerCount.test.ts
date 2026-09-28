import { describe, expect, it } from 'vitest'

import { isValidSpeakerCount, MAX_SPEAKER_COUNT, MIN_SPEAKER_COUNT } from './speakerCount'

describe('isValidSpeakerCount', () => {
  it('허용 범위 안의 정수만 통과시킨다', () => {
    expect(isValidSpeakerCount(MIN_SPEAKER_COUNT)).toBe(true)
    expect(isValidSpeakerCount(MAX_SPEAKER_COUNT)).toBe(true)
    expect(isValidSpeakerCount(4)).toBe(true)
  })

  it('범위 밖·소수·숫자가 아닌 값은 거절한다', () => {
    expect(isValidSpeakerCount(MIN_SPEAKER_COUNT - 1)).toBe(false)
    expect(isValidSpeakerCount(MAX_SPEAKER_COUNT + 1)).toBe(false)
    expect(isValidSpeakerCount(2.5)).toBe(false)
    expect(isValidSpeakerCount('3')).toBe(false)
    expect(isValidSpeakerCount(NaN)).toBe(false)
    expect(isValidSpeakerCount(undefined)).toBe(false)
  })
})
