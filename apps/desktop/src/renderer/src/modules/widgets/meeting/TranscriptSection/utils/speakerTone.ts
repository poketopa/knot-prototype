import type { SpeakerOption } from '../types/transcript'

/** `--color-speaker-1`~`8`. 아홉 번째 화자부터 처음 색으로 돌아간다 (references/architecture.md "디자인 토큰") */
export const SPEAKER_TONE_COUNT = 8

interface SpeakerToneOfParams {
  speakerOptions: SpeakerOption[]
  label: string
}

/** 화자 목록 순서대로 1부터 색 번호를 매긴다. 목록에 없는 라벨은 1번 */
export const speakerToneOf = ({ speakerOptions, label }: SpeakerToneOfParams) => {
  const index = speakerOptions.findIndex((option) => option.label === label)

  return (Math.max(0, index) % SPEAKER_TONE_COUNT) + 1
}
