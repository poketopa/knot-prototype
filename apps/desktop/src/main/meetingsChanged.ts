let notify: () => void = () => {}

/**
 * 회의 목록에 영향을 주는 변경을 한곳으로 모은다. 사이드바는 언마운트되지 않아 화면 진입 때 다시 읽는 방식으로는
 * 제목 변경·삭제·처리 완료를 놓친다 (references/architecture.md "목록 갱신").
 * main이 창을 만든 뒤 한 번 등록한다. 창이 없을 때 부르면 무시된다.
 */
export const setMeetingsChangedListener = (listener: () => void) => {
  notify = listener
}

export const notifyMeetingsChanged = () => notify()
