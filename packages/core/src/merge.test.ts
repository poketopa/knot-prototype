import { describe, expect, it } from 'vitest'

import {
  absorbMinorSpeakers,
  assignSpeakers,
  mergeUtterances,
  UNKNOWN_SPEAKER,
  voteBySentence
} from './merge'
import type { SpeakerPiece, SpeakerSegment, SttSegment } from './types'

const speakerSegments: SpeakerSegment[] = [
  { start: 0, end: 5, speaker: 'speaker_00' },
  { start: 5, end: 10, speaker: 'speaker_01' }
]

describe('assignSpeakers', () => {
  it('겹침이 가장 큰 화자를 단어에 배정한다', () => {
    const segments: SttSegment[] = [
      {
        start: 0,
        end: 8,
        text: '안녕하세요 반갑습니다',
        words: [
          { start: 0.5, end: 2, text: '안녕하세요' },
          { start: 6, end: 7.5, text: '반갑습니다' }
        ]
      }
    ]

    const pieces = assignSpeakers({ segments, speakerSegments })

    expect(pieces.map((piece) => piece.speaker)).toEqual(['speaker_00', 'speaker_01'])
  })

  it('단어 타임스탬프가 없으면 세그먼트 전체로 배정한다', () => {
    const segments: SttSegment[] = [{ start: 6, end: 9, text: '네 알겠습니다' }]

    const pieces = assignSpeakers({ segments, speakerSegments })

    expect(pieces).toEqual([{ speaker: 'speaker_01', start: 6, end: 9, text: '네 알겠습니다' }])
  })

  it('겹치는 화자 구간이 없으면 직전 화자를 승계한다', () => {
    const segments: SttSegment[] = [
      {
        start: 0,
        end: 30,
        text: '앞 뒤',
        words: [
          { start: 1, end: 2, text: '앞' },
          { start: 20, end: 21, text: '뒤' }
        ]
      }
    ]

    const pieces = assignSpeakers({ segments, speakerSegments })

    expect(pieces.map((piece) => piece.speaker)).toEqual(['speaker_00', 'speaker_00'])
  })

  it('경계에서 어느 구간에도 걸치지 않는 단어는 가까운 화자에 붙인다', () => {
    const gapped: SpeakerSegment[] = [
      { start: 0, end: 5, speaker: 'speaker_00' },
      { start: 5.5, end: 10, speaker: 'speaker_01' }
    ]
    const segments: SttSegment[] = [
      {
        start: 0,
        end: 6,
        text: '앞말 뒷말',
        words: [
          { start: 1, end: 2, text: '앞말' },
          { start: 5.4, end: 5.45, text: '뒷말' }
        ]
      }
    ]

    const pieces = assignSpeakers({ segments, speakerSegments: gapped })

    expect(pieces.map((piece) => piece.speaker)).toEqual(['speaker_00', 'speaker_01'])
  })

  it('승계할 직전 화자도 없으면 UNKNOWN을 쓴다', () => {
    const segments: SttSegment[] = [{ start: 20, end: 21, text: '혼자' }]

    const pieces = assignSpeakers({ segments, speakerSegments })

    expect(pieces[0].speaker).toBe(UNKNOWN_SPEAKER)
  })

  it('화자 구간이 비어 있어도 전사 결과를 잃지 않는다', () => {
    const segments: SttSegment[] = [{ start: 0, end: 1, text: '화자 정보 없음' }]

    const pieces = assignSpeakers({ segments, speakerSegments: [] })

    expect(pieces).toHaveLength(1)
    expect(pieces[0].speaker).toBe(UNKNOWN_SPEAKER)
  })

  it('전사 결과가 없으면 빈 배열을 반환한다', () => {
    expect(assignSpeakers({ segments: [], speakerSegments })).toEqual([])
  })

  it('화자 구간 경계를 넘어간 문장 끝 단어는 문장의 주 화자를 따른다', () => {
    const segments: SttSegment[] = [
      {
        start: 2,
        end: 5.6,
        text: '악보가 그려지거든요.',
        words: [
          { start: 2, end: 4.8, text: '악보가' },
          { start: 5.2, end: 5.6, text: '그려지거든요.' }
        ]
      },
      {
        start: 5.8,
        end: 8,
        text: '무슨 느낌인지 알겠어요.',
        words: [
          { start: 5.8, end: 7, text: '무슨' },
          { start: 7, end: 8, text: '느낌인지' },
          { start: 8, end: 8, text: '알겠어요.' }
        ]
      }
    ]

    const pieces = assignSpeakers({ segments, speakerSegments, isMinorSpeakerAbsorbed: false })

    expect(pieces.map((piece) => piece.speaker)).toEqual([
      'speaker_00',
      'speaker_00',
      'speaker_01',
      'speaker_01',
      'speaker_01'
    ])
  })
})

describe('voteBySentence', () => {
  const piece = (speaker: string, start: number, end: number, text: string): SpeakerPiece => ({
    speaker,
    start,
    end,
    text
  })

  const eachSegment = (pieces: SpeakerPiece[]) => ({
    pieces,
    isSegmentEnds: pieces.map(() => true)
  })

  it('문장 안에서 발화 시간이 가장 긴 화자를 문장 전체에 준다', () => {
    const voted = voteBySentence(
      eachSegment([
        piece('speaker_00', 0, 2, '이렇게'),
        piece('speaker_01', 2, 2.3, '무슨'),
        piece('speaker_00', 2.3, 3, '뜻인지.')
      ])
    )

    expect(voted.map((item) => item.speaker)).toEqual(['speaker_00', 'speaker_00', 'speaker_00'])
  })

  it('문장부호로 끝나면 다음 문장은 따로 투표한다', () => {
    const voted = voteBySentence(
      eachSegment([piece('speaker_00', 0, 2, '질문 있나요?'), piece('speaker_01', 2.1, 2.5, '네.')])
    )

    expect(voted.map((item) => item.speaker)).toEqual(['speaker_00', 'speaker_01'])
  })

  it('문장부호가 없어도 1초 이상 쉬면 문장을 나눈다', () => {
    const voted = voteBySentence(
      eachSegment([piece('speaker_00', 0, 3, '여기까지 하고'), piece('speaker_01', 4, 4.5, '그럼')])
    )

    expect(voted.map((item) => item.speaker)).toEqual(['speaker_00', 'speaker_01'])
  })

  it('길이가 0인 단어도 표를 센다', () => {
    const voted = voteBySentence(
      eachSegment([
        piece('speaker_00', 1, 1, '알'),
        piece('speaker_00', 1, 1, '것'),
        piece('speaker_01', 1, 1.06, '같아요.')
      ])
    )

    expect(voted.map((item) => item.speaker)).toEqual(['speaker_00', 'speaker_00', 'speaker_00'])
  })

  it('문장부호 없이 8초를 넘기면 다음 세그먼트 경계에서 문장을 끊는다', () => {
    const voted = voteBySentence(
      eachSegment([
        piece('speaker_00', 0, 4, '그래서 이걸'),
        piece('speaker_00', 4, 8.5, '바꾸면 되는데'),
        piece('speaker_01', 8.5, 11, '그건 제가 해볼게요'),
        piece('speaker_01', 11, 12, '이따가')
      ])
    )

    expect(voted.map((item) => item.speaker)).toEqual([
      'speaker_00',
      'speaker_00',
      'speaker_01',
      'speaker_01'
    ])
  })

  it('세그먼트 중간에서는 8초를 넘겨도 문장을 끊지 않는다', () => {
    const voted = voteBySentence({
      pieces: [
        piece('speaker_00', 0, 9, '길게'),
        piece('speaker_01', 9, 9.5, '이어지는'),
        piece('speaker_00', 9.5, 10, '말.')
      ],
      isSegmentEnds: [false, false, true]
    })

    expect(voted.map((item) => item.speaker)).toEqual(['speaker_00', 'speaker_00', 'speaker_00'])
  })

  it('입력이 없으면 빈 배열을 반환한다', () => {
    expect(voteBySentence({ pieces: [], isSegmentEnds: [] })).toEqual([])
  })
})

describe('mergeUtterances', () => {
  it('같은 화자의 연속 발화를 하나로 합친다', () => {
    const merged = mergeUtterances([
      { speaker: 'speaker_00', start: 0, end: 1.2, text: '안녕하세요' },
      { speaker: 'speaker_00', start: 1.3, end: 2.5, text: '회의 시작하겠습니다' }
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0].text).toBe('안녕하세요 회의 시작하겠습니다')
    expect(merged[0].startSec).toBe(0)
    expect(merged[0].endSec).toBe(2.5)
  })

  it('화자가 바뀌면 발화를 나누고 ord를 0부터 매긴다', () => {
    const merged = mergeUtterances([
      { speaker: 'speaker_00', start: 0, end: 2, text: '먼저 말합니다' },
      { speaker: 'speaker_01', start: 2, end: 4, text: '이어서 말합니다' }
    ])

    expect(merged.map((utterance) => utterance.ord)).toEqual([0, 1])
    expect(merged.map((utterance) => utterance.speakerLabel)).toEqual(['speaker_00', 'speaker_01'])
  })

  it('0.5초 미만 고아 발화는 앞 발화에 흡수한다', () => {
    const merged = mergeUtterances([
      { speaker: 'speaker_00', start: 0, end: 3, text: '길게 말하는 중인데' },
      { speaker: 'speaker_01', start: 3, end: 3.2, text: '음' },
      { speaker: 'speaker_00', start: 3.2, end: 6, text: '계속 이어집니다' }
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0].speakerLabel).toBe('speaker_00')
    expect(merged[0].text).toBe('길게 말하는 중인데 음 계속 이어집니다')
  })

  it('앞 발화가 없는 고아는 뒤 발화에 흡수한다', () => {
    const merged = mergeUtterances([
      { speaker: 'speaker_01', start: 0, end: 0.2, text: '어' },
      { speaker: 'speaker_00', start: 0.2, end: 4, text: '시작하겠습니다' }
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0].speakerLabel).toBe('speaker_00')
    expect(merged[0].text).toBe('어 시작하겠습니다')
  })

  it('전체가 짧은 발화 하나뿐이면 그대로 남긴다', () => {
    const merged = mergeUtterances([{ speaker: 'speaker_00', start: 0, end: 0.3, text: '네' }])

    expect(merged).toHaveLength(1)
    expect(merged[0].text).toBe('네')
  })

  it('빈 입력이면 빈 배열을 반환한다', () => {
    expect(mergeUtterances([])).toEqual([])
  })
})

describe('absorbMinorSpeakers', () => {
  const majorSegments: SpeakerSegment[] = [
    { start: 0, end: 20, speaker: 'speaker_00' },
    { start: 25, end: 45, speaker: 'speaker_01' }
  ]

  it('총 발화가 짧은 화자의 구간을 시간상 가장 가까운 주요 화자에게 넘긴다', () => {
    const fragments: SpeakerSegment[] = [
      { start: 21, end: 23, speaker: 'speaker_07' },
      { start: 46, end: 47, speaker: 'speaker_09' }
    ]

    const absorbed = absorbMinorSpeakers([...majorSegments, ...fragments])

    expect(absorbed.map((segment) => segment.speaker)).toEqual([
      'speaker_00',
      'speaker_01',
      'speaker_00',
      'speaker_01'
    ])
  })

  it('주요 화자가 한 명도 없으면 그대로 둔다', () => {
    const shortOnly: SpeakerSegment[] = [
      { start: 0, end: 3, speaker: 'speaker_00' },
      { start: 3, end: 5, speaker: 'speaker_01' }
    ]

    expect(absorbMinorSpeakers(shortOnly)).toEqual(shortOnly)
  })

  it('assignSpeakers는 흡수된 라벨로 단어를 배정한다', () => {
    const segments: SttSegment[] = [{ start: 21, end: 23, text: '네네' }]
    const withFragment = [...majorSegments, { start: 21, end: 23, speaker: 'speaker_07' }]

    const pieces = assignSpeakers({ segments, speakerSegments: withFragment })

    expect(pieces[0].speaker).toBe('speaker_00')
  })

  it('참석자 수로 군집한 결과(isMinorSpeakerAbsorbed=false)는 짧은 화자를 지우지 않는다', () => {
    const segments: SttSegment[] = [{ start: 21, end: 23, text: '네네' }]
    const withFragment = [...majorSegments, { start: 21, end: 23, speaker: 'speaker_07' }]

    const pieces = assignSpeakers({
      segments,
      speakerSegments: withFragment,
      isMinorSpeakerAbsorbed: false
    })

    expect(pieces[0].speaker).toBe('speaker_07')
  })
})
