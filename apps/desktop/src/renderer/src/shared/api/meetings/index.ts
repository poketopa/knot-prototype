import type {
  DeleteMeetingRequest,
  GetMeetingRequest,
  RenameMeetingRequest,
  SearchMeetingsRequest
} from '@shared/ipc'

/**
 * @description 회의 목록을 최신순으로 불러옵니다.
 * @returns 회의 목록
 * @example
 * const meetings = await getMeetingsApi()
 */
export const getMeetingsApi = async () => window.api.meetings.list()

/**
 * @description 회의 하나의 상세(회의 정보 + 발화 + 화자)를 불러옵니다.
 * @param meetingId - 회의 ID
 * @returns 회의 상세. 없는 회의면 null
 * @example
 * const detail = await getMeetingApi({ meetingId })
 */
export const getMeetingApi = async ({ meetingId }: GetMeetingRequest) =>
  window.api.meetings.get({ meetingId })

/**
 * @description 회의 제목을 바꿉니다.
 * @param meetingId - 회의 ID
 * @param title - 새 제목
 * @returns 갱신된 회의 상세
 * @example
 * const detail = await renameMeetingApi({ meetingId, title: '9월 스프린트 회고' })
 */
export const renameMeetingApi = async ({ meetingId, title }: RenameMeetingRequest) =>
  window.api.meetings.rename({ meetingId, title })

/**
 * @description 회의를 지웁니다. 발화·화자와 원본 녹음 파일도 함께 사라집니다.
 * @param meetingId - 회의 ID
 * @returns 없음
 * @example
 * await deleteMeetingApi({ meetingId })
 */
export const deleteMeetingApi = async ({ meetingId }: DeleteMeetingRequest) => {
  await window.api.meetings.delete({ meetingId })
}

/**
 * @description 회의 제목과 발화 텍스트에서 검색어를 찾습니다. 최신순으로 최대 50개를 돌려줍니다.
 * @param query - 검색어. 공백뿐이면 빈 결과
 * @returns 회의와, 발화로 걸렸으면 처음 걸린 발화 하나
 * @example
 * const results = await searchMeetingsApi({ query: '배포' })
 */
export const searchMeetingsApi = async ({ query }: SearchMeetingsRequest) =>
  window.api.meetings.search({ query })
