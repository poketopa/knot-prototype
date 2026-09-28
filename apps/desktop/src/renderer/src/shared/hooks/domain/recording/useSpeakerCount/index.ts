import { useState } from 'react'
import { isValidSpeakerCount } from '@meeting-stt/core/speakerCount'
import { setSpeakerCountApi } from '@renderer/shared/api/recording'

interface SpeakerCountDraft {
  text: string
  /** 이 입력을 시작할 때의 세션 값. 세션 값이 바뀌면(다른 창에서 수정) 초안을 버린다 */
  sessionValue?: number
}

interface UseSpeakerCountParams {
  /** main 세션이 보관 중인 참석자 수 */
  speakerCount?: number
}

/** 빈 입력은 "모름"(임계값 폴백), 그 외는 정수 범위 검사를 통과해야 넘긴다 */
const parseSpeakerCount = (text: string) => {
  if (text.trim() === '') return { speakerCount: undefined, isValid: true }

  const value = Number(text)

  return { speakerCount: value, isValid: isValidSpeakerCount(value) }
}

/**
 * 참석자 수 입력. 값의 출처는 main 세션 하나라 입력이 바뀔 때마다 세션에 보내고,
 * 다른 창에서 바뀐 값은 세션 값이 달라지는 것으로 알 수 있다 (effect 없이 초안을 버린다).
 */
const useSpeakerCount = ({ speakerCount }: UseSpeakerCountParams) => {
  const [draft, setDraft] = useState<SpeakerCountDraft | null>(null)
  const sessionText = speakerCount === undefined ? '' : String(speakerCount)
  const text = draft && draft.sessionValue === speakerCount ? draft.text : sessionText
  const { isValid } = parseSpeakerCount(text)

  const changeText = (nextText: string) => {
    setDraft({ text: nextText, sessionValue: speakerCount })

    const parsed = parseSpeakerCount(nextText)
    // 범위 밖 값은 보내지 않는다. 입력 중에 잠깐 거쳐 가는 값일 뿐이다
    if (!parsed.isValid) return

    setSpeakerCountApi({ speakerCount: parsed.speakerCount }).catch(() =>
      console.error('참석자 수를 저장하지 못했습니다')
    )
  }

  return { text, isValid, changeText }
}

export default useSpeakerCount
