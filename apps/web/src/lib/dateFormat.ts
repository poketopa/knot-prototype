/** 사이드바·회의록 헤더에 찍는 날짜·길이 문구 */

const MS_PER_DAY = 24 * 60 * 60 * 1000
const SEC_PER_MIN = 60
const MIN_PER_HOUR = 60
const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토']

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())

const formatClock = (date: Date) =>
  new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit', hour12: true }).format(
    date
  )

interface FormatRelativeDayParams {
  timestampMs: number
  now?: Date
}

/** "오늘 오후 2:10" · "어제" · "9월 22일" · "2025년 9월 22일" */
export const formatRelativeDay = ({ timestampMs, now = new Date() }: FormatRelativeDayParams) => {
  const date = new Date(timestampMs)
  const dayDiff = Math.round((startOfDay(now).getTime() - startOfDay(date).getTime()) / MS_PER_DAY)

  if (dayDiff === 0) return `오늘 ${formatClock(date)}`
  if (dayDiff === 1) return '어제'
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}월 ${date.getDate()}일`
  }

  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`
}

/** "2026년 9월 24일 (목) 오후 2:10" */
export const formatFullDate = (timestampMs: number) => {
  const date = new Date(timestampMs)

  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEKDAY_NAMES[date.getDay()]}) ${formatClock(date)}`
}

/** "48분" · "1시간 12분" · "40초" */
export const formatDurationWords = (sec: number) => {
  const totalMinutes = Math.floor(sec / SEC_PER_MIN)
  const hours = Math.floor(totalMinutes / MIN_PER_HOUR)
  const minutes = totalMinutes % MIN_PER_HOUR

  if (hours > 0) return minutes > 0 ? `${hours}시간 ${minutes}분` : `${hours}시간`
  if (totalMinutes > 0) return `${totalMinutes}분`

  return `${Math.round(sec)}초`
}

/** 새 기록의 기본 제목. 사용자가 회의록 화면에서 바꾼다 */
export const defaultMeetingTitle = (timestampMs: number) => {
  const date = new Date(timestampMs)

  return `${date.getMonth() + 1}월 ${date.getDate()}일 회의`
}
