import { resolveSpeakerNames } from '@meeting-stt/core/format'
import type { Speaker, Utterance } from '@shared/types'

import type { SpeakerOption } from '../types/transcript'

interface ToSpeakerOptionsParams {
  speakers: Speaker[]
  utterances: Utterance[]
}

/**
 * 화자 목록을 등장 순서대로 만든다. 번호(`화자 N`)는 발화 등장 순서로 매기므로 발화 라벨을 먼저 넣고,
 * 발화가 하나도 없는 화자는 뒤에 붙인다 (@shared/format).
 * 화자 행이 없는 라벨도 목록에 남겨 발화가 이름 없이 보이는 일이 없게 한다.
 */
export const toSpeakerOptions = ({ speakers, utterances }: ToSpeakerOptionsParams) => {
  const labels = [
    ...utterances.map((utterance) => utterance.speakerLabel),
    ...speakers.map((speaker) => speaker.label)
  ]
  const names = resolveSpeakerNames({
    labels,
    displayNames: Object.fromEntries(speakers.map(({ label, displayName }) => [label, displayName]))
  })

  return [...new Set(labels)].map<SpeakerOption>((label) => ({ label, name: names[label] }))
}
