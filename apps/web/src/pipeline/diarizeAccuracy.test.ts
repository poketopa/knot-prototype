import { describe, expect, it } from 'vitest'

import { measureDiarizationAccuracy } from './diarizeAccuracy'

const reference = [
  { speaker: '진행자', startSec: 0, endSec: 5 },
  { speaker: '개발', startSec: 5, endSec: 10 }
]

describe('measureDiarizationAccuracy', () => {
  it('이름이 달라도 대응이 맞으면 100%', () => {
    const measured = measureDiarizationAccuracy({
      speakerSegments: [
        { start: 0, end: 5, speaker: 'speaker_01' },
        { start: 5, end: 10, speaker: 'speaker_00' }
      ],
      reference,
      durationSec: 10
    })

    expect(measured.accuracy).toBe(1)
    expect(measured.predictedSpeakerCount).toBe(2)
    expect(measured.referenceSpeakerCount).toBe(2)
  })

  it('전부 한 화자로 묶으면 절반만 맞는다', () => {
    const measured = measureDiarizationAccuracy({
      speakerSegments: [{ start: 0, end: 10, speaker: 'speaker_00' }],
      reference,
      durationSec: 10
    })

    expect(measured.accuracy).toBeCloseTo(0.5, 5)
  })

  it('화자를 못 붙인 프레임은 오답으로 센다', () => {
    const measured = measureDiarizationAccuracy({
      speakerSegments: [{ start: 0, end: 5, speaker: 'speaker_00' }],
      reference,
      durationSec: 10
    })

    expect(measured.accuracy).toBeCloseTo(0.5, 5)
  })
})
