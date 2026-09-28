/** 용어 목록 한 행의 입력값. `readings`는 사용자가 친 그대로이고 저장할 때 나눈다 */
export interface TermEntry {
  term: string
  readings: string
}

/** 화면의 행. `id`는 리스트 key와 포커스용이며 저장하지 않는다 */
export interface TermRow extends TermEntry {
  id: number
}
