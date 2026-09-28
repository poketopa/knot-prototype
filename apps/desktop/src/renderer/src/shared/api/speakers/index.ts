import type { MergeSpeakersRequest, RenameSpeakerRequest } from '@shared/ipc'

/**
 * @description 화자 라벨에 표시 이름을 지정합니다. 같은 라벨의 모든 발화에 반영됩니다.
 * @param meetingId - 회의 ID
 * @param label - 화자 분리 결과의 원본 라벨
 * @param displayName - 사용자가 지정한 이름
 * @returns 갱신된 회의 상세
 * @example
 * const detail = await renameSpeakerApi({ meetingId, label: 'speaker_00', displayName: '김팀장' })
 */
export const renameSpeakerApi = async ({ meetingId, label, displayName }: RenameSpeakerRequest) =>
  window.api.speakers.rename({ meetingId, label, displayName })

/**
 * @description 화자 둘을 하나로 합칩니다. fromLabel의 발화가 전부 intoLabel로 넘어가고 fromLabel은 사라집니다.
 * @param meetingId - 회의 ID
 * @param fromLabel - 사라질 화자의 라벨
 * @param intoLabel - 발화를 넘겨받을 화자의 라벨
 * @returns 갱신된 회의 상세
 * @example
 * const detail = await mergeSpeakersApi({ meetingId, fromLabel: 'speaker_02', intoLabel: 'speaker_00' })
 */
export const mergeSpeakersApi = async ({ meetingId, fromLabel, intoLabel }: MergeSpeakersRequest) =>
  window.api.speakers.merge({ meetingId, fromLabel, intoLabel })
