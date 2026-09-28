import { UNKNOWN_SPEAKER } from './merge'
import type { MergedUtterance } from './types'

export type TranscriptFormat = 'plain' | 'markdown'

const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3600
const UNKNOWN_SPEAKER_NAME = '화자 미상'

const pad2 = (value: number) => String(value).padStart(2, '0')

/** 초를 hh:mm:ss 고정폭 문자열로 만든다 */
export const formatTimestamp = ({ sec }: { sec: number }) => {
  const total = Math.max(0, Math.floor(sec))
  const hours = Math.floor(total / SECONDS_PER_HOUR)
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)

  return `${pad2(hours)}:${pad2(minutes)}:${pad2(total % SECONDS_PER_MINUTE)}`
}

interface ResolveSpeakerNamesParams {
  labels: string[]
  displayNames?: Record<string, string | null>
}

/**
 * 라벨 → 표시 이름. 지정된 이름이 없으면 "화자 N"을 붙인다.
 * 번호는 이름 지정 여부와 무관하게 등장 순서로 매긴다 — 한 화자의 이름을 바꿔도
 * 나머지 화자의 번호가 밀리지 않아야 하기 때문이다.
 * 화자를 배정하지 못한 UNKNOWN 라벨은 번호를 차지하지 않는다.
 */
export const resolveSpeakerNames = ({ labels, displayNames = {} }: ResolveSpeakerNamesParams) => {
  const names: Record<string, string> = {}
  let numbered = 0

  for (const label of labels) {
    if (names[label]) continue

    if (label === UNKNOWN_SPEAKER) {
      names[label] = UNKNOWN_SPEAKER_NAME
      continue
    }

    numbered += 1
    names[label] = displayNames[label] || `화자 ${numbered}`
  }

  return names
}

interface FormatTranscriptParams {
  utterances: MergedUtterance[]
  displayNames?: Record<string, string | null>
  format?: TranscriptFormat
}

/** 복사·내보내기용 회의록 텍스트 */
export const formatTranscript = ({
  utterances,
  displayNames,
  format = 'plain'
}: FormatTranscriptParams) => {
  const names = resolveSpeakerNames({
    labels: utterances.map((utterance) => utterance.speakerLabel),
    displayNames
  })

  return utterances
    .map((utterance) => {
      const name = names[utterance.speakerLabel]
      const speaker = format === 'markdown' ? `**${name}**` : name

      return `[${formatTimestamp({ sec: utterance.startSec })}] ${speaker}: ${utterance.text}`
    })
    .join('\n')
}
