/** 사이드바 검색 결과의 최대 개수 (references/architecture.md "회의록 검색") */
export const SEARCH_RESULT_LIMIT = 50

const LIKE_ESCAPE_PATTERN = /[\\%_]/g

/**
 * 검색어를 `LIKE ? ESCAPE '\'`에 넣을 부분 일치 패턴으로 바꾼다. `%`·`_`·`\`는 글자 그대로 찾도록 이스케이프한다.
 * 앞뒤 공백만 있는 질의는 null — 전체 목록을 검색 결과로 돌려주지 않는다.
 */
export const toLikePattern = (query: string) => {
  const trimmed = query.trim()
  if (!trimmed) return null

  return `%${trimmed.replace(LIKE_ESCAPE_PATTERN, (char) => `\\${char}`)}%`
}
