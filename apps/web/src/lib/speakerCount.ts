import { isValidSpeakerCount } from '@meeting-stt/core/speakerCount'

/** 스테퍼의 문자열 값 → 검증을 통과한 참석자 수. 비었거나 범위 밖이면 null */
export const parseSpeakerCount = (text: string) => {
  const parsed = Number(text.trim())
  return text.trim() !== '' && isValidSpeakerCount(parsed) ? parsed : null
}
