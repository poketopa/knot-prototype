import type { ReassignUtteranceRequest, UpdateUtteranceTextRequest } from '@shared/ipc'

/**
 * @description 발화 한 개의 텍스트를 저장합니다.
 * @param meetingId - 회의 ID
 * @param utteranceId - 발화 ID
 * @param text - 사용자가 고친 내용
 * @returns 갱신된 회의 상세
 * @example
 * const detail = await updateUtteranceTextApi({ meetingId, utteranceId, text: '다시 정리하겠습니다' })
 */
export const updateUtteranceTextApi = async ({
  meetingId,
  utteranceId,
  text
}: UpdateUtteranceTextRequest) => window.api.utterances.updateText({ meetingId, utteranceId, text })

/**
 * @description 발화 한 개를 다른 화자에게 넘깁니다. 다른 발화는 그대로 둡니다.
 * @param meetingId - 회의 ID
 * @param utteranceId - 발화 ID
 * @param speakerLabel - 넘겨받을 화자의 원본 라벨
 * @returns 갱신된 회의 상세
 * @example
 * const detail = await reassignUtteranceApi({ meetingId, utteranceId, speakerLabel: 'speaker_01' })
 */
export const reassignUtteranceApi = async ({
  meetingId,
  utteranceId,
  speakerLabel
}: ReassignUtteranceRequest) =>
  window.api.utterances.reassign({ meetingId, utteranceId, speakerLabel })
