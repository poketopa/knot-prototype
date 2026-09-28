import { describe, expect, it } from 'vitest'

import { formatTimestamp, formatTranscript, resolveSpeakerNames } from './format'
import { UNKNOWN_SPEAKER } from './merge'
import type { MergedUtterance } from './types'

const utterances: MergedUtterance[] = [
  {
    ord: 0,
    speakerLabel: 'speaker_01',
    startSec: 12.4,
    endSec: 20,
    text: '배포 일정부터 정리하겠습니다.'
  },
  {
    ord: 1,
    speakerLabel: 'speaker_00',
    startSec: 25.9,
    endSec: 31,
    text: 'QA 이슈가 하나 남아 있습니다.'
  }
]

describe('formatTimestamp', () => {
  it('초를 hh:mm:ss 고정폭으로 만든다', () => {
    expect(formatTimestamp({ sec: 0 })).toBe('00:00:00')
    expect(formatTimestamp({ sec: 12.9 })).toBe('00:00:12')
    expect(formatTimestamp({ sec: 3671 })).toBe('01:01:11')
  })

  it('음수는 00:00:00으로 처리한다', () => {
    expect(formatTimestamp({ sec: -3 })).toBe('00:00:00')
  })
})

describe('resolveSpeakerNames', () => {
  it('등장 순서대로 화자 번호를 매긴다', () => {
    const names = resolveSpeakerNames({ labels: ['speaker_01', 'speaker_00', 'speaker_01'] })

    expect(names).toEqual({ speaker_01: '화자 1', speaker_00: '화자 2' })
  })

  it('지정된 이름이 있으면 그 이름을 쓴다', () => {
    const names = resolveSpeakerNames({
      labels: ['speaker_00', 'speaker_01'],
      displayNames: { speaker_00: '김팀장', speaker_01: null }
    })

    expect(names).toEqual({ speaker_00: '김팀장', speaker_01: '화자 2' })
  })

  it('화자를 배정하지 못한 라벨은 화자 미상으로 표기한다', () => {
    const names = resolveSpeakerNames({ labels: [UNKNOWN_SPEAKER, 'speaker_00'] })

    expect(names[UNKNOWN_SPEAKER]).toBe('화자 미상')
    expect(names.speaker_00).toBe('화자 1')
  })
})

describe('formatTranscript', () => {
  it('타임스탬프와 화자 이름을 붙인 플레인 텍스트를 만든다', () => {
    expect(formatTranscript({ utterances })).toBe(
      [
        '[00:00:12] 화자 1: 배포 일정부터 정리하겠습니다.',
        '[00:00:25] 화자 2: QA 이슈가 하나 남아 있습니다.'
      ].join('\n')
    )
  })

  it('마크다운은 화자 이름을 굵게 쓴다', () => {
    const markdown = formatTranscript({ utterances, format: 'markdown' })

    expect(markdown.split('\n')[0]).toBe('[00:00:12] **화자 1**: 배포 일정부터 정리하겠습니다.')
  })

  it('발화가 없으면 빈 문자열을 반환한다', () => {
    expect(formatTranscript({ utterances: [] })).toBe('')
  })
})
