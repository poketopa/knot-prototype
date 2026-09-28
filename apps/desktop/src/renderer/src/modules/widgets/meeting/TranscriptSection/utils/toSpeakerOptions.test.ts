import { describe, expect, it } from 'vitest'
import type { Speaker, Utterance } from '@shared/types'
import { toSpeakerOptions } from './toSpeakerOptions'

const utteranceOf = (speakerLabel: string, ord: number): Utterance => ({
  id: `utterance-${ord}`,
  meetingId: 'meeting-1',
  ord,
  speakerLabel,
  startSec: ord,
  endSec: ord + 1,
  text: '내용'
})

const speakerOf = (label: string, displayName: string | null = null): Speaker => ({
  meetingId: 'meeting-1',
  label,
  displayName
})

describe('toSpeakerOptions', () => {
  it('발화에 등장한 순서대로 번호를 매긴다', () => {
    const options = toSpeakerOptions({
      utterances: [utteranceOf('speaker_01', 0), utteranceOf('speaker_00', 1)],
      speakers: [speakerOf('speaker_00'), speakerOf('speaker_01')]
    })

    expect(options).toEqual([
      { label: 'speaker_01', name: '화자 1' },
      { label: 'speaker_00', name: '화자 2' }
    ])
  })

  it('이름을 지정한 화자는 그 이름을 쓰고 나머지 번호는 밀리지 않는다', () => {
    const options = toSpeakerOptions({
      utterances: [utteranceOf('speaker_00', 0), utteranceOf('speaker_01', 1)],
      speakers: [speakerOf('speaker_00', '김팀장'), speakerOf('speaker_01')]
    })

    expect(options).toEqual([
      { label: 'speaker_00', name: '김팀장' },
      { label: 'speaker_01', name: '화자 2' }
    ])
  })

  it('발화가 없는 화자도 목록에 남긴다', () => {
    const options = toSpeakerOptions({
      utterances: [utteranceOf('speaker_00', 0)],
      speakers: [speakerOf('speaker_00'), speakerOf('speaker_09', '기록 담당')]
    })

    expect(options.map(({ label }) => label)).toEqual(['speaker_00', 'speaker_09'])
  })

  it('화자를 배정하지 못한 발화는 화자 미상으로 보여 준다', () => {
    const options = toSpeakerOptions({
      utterances: [utteranceOf('UNKNOWN', 0), utteranceOf('speaker_00', 1)],
      speakers: [speakerOf('speaker_00')]
    })

    expect(options).toEqual([
      { label: 'UNKNOWN', name: '화자 미상' },
      { label: 'speaker_00', name: '화자 1' }
    ])
  })

  it('발화도 화자도 없으면 빈 목록이다', () => {
    expect(toSpeakerOptions({ utterances: [], speakers: [] })).toEqual([])
  })
})
