export interface HighlightSegment {
  text: string
  isMatch: boolean
}

interface HighlightMatchParams {
  text: string
  query: string
  /** 조각이 이보다 길면 첫 일치 부분을 가운데 두고 앞뒤를 자른다 */
  maxChars: number
}

const ELLIPSIS = '…'

/** 일치 앞에 남길 글자 비율. 뒤쪽 문맥이 더 읽힌다 */
const LEADING_RATIO = 0.3

const trimAround = ({
  text,
  index,
  maxChars
}: {
  text: string
  index: number
  maxChars: number
}) => {
  if (text.length <= maxChars) return text

  const leading = Math.floor(maxChars * LEADING_RATIO)
  const start = Math.max(0, Math.min(index - leading, text.length - maxChars))
  const end = start + maxChars

  return `${start > 0 ? ELLIPSIS : ''}${text.slice(start, end)}${end < text.length ? ELLIPSIS : ''}`
}

/**
 * 검색 결과 조각을 일치 부분과 나머지로 나눈다. SQLite LIKE처럼 ASCII 대소문자를 구분하지 않는다.
 * 일치가 없으면 통째로 한 조각이다 (제목으로만 걸린 경우).
 */
export const highlightMatch = ({ text, query, maxChars }: HighlightMatchParams) => {
  const needle = query.trim().toLowerCase()
  const firstIndex = needle ? text.toLowerCase().indexOf(needle) : -1
  const trimmed = trimAround({ text, index: Math.max(0, firstIndex), maxChars })
  if (firstIndex < 0) return [{ text: trimmed, isMatch: false }]

  const lower = trimmed.toLowerCase()
  const segments: HighlightSegment[] = []
  let cursor = 0

  for (let index = lower.indexOf(needle); index >= 0; index = lower.indexOf(needle, cursor)) {
    if (index > cursor) segments.push({ text: trimmed.slice(cursor, index), isMatch: false })
    segments.push({ text: trimmed.slice(index, index + needle.length), isMatch: true })
    cursor = index + needle.length
  }
  if (cursor < trimmed.length) {
    segments.push({ text: trimmed.slice(cursor), isMatch: false })
  }

  return segments
}
