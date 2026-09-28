import type { CreateSummaryRequest } from '@shared/ipc'

/**
 * @description 회의록 요약을 요청합니다. 잡을 큐에 넣기만 하고 즉시 반환하며, 결과는 `onSummaryProgress`로 옵니다.
 * @param meetingId - 회의 ID
 * @returns 없음
 * @example
 * await createSummaryApi({ meetingId })
 */
export const createSummaryApi = async ({ meetingId }: CreateSummaryRequest) => {
  await window.api.summary.create({ meetingId })
}
