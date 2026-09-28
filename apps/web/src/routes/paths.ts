/** 경로 상수. 링크·이동은 전부 여기서 가져다 쓴다 (계획 §10 "라우트") */
export const PATHS = {
  home: '/',
  record: '/record',
  meetingDetail: '/meetings/:id',
  /** 리디자인 전의 프로토타입 페이지. 실측·디버깅용 */
  test: '/test'
} as const

export const meetingPath = (id: string) => `/meetings/${encodeURIComponent(id)}`
