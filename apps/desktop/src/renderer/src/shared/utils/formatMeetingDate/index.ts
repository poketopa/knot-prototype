const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const NOON_HOUR = 12

/**
 * "오후 2:10". Intl 대신 직접 조립하는 이유는 실행 환경의 ICU 데이터에 따라 문구가 달라지지 않게 하기 위해서다.
 * 자정은 "오전 12:00", 정오는 "오후 12:00"으로 읽는다.
 */
export const formatMeetingTime = ({ epochMs }: { epochMs: number }) => {
  const date = new Date(epochMs)
  const hours = date.getHours()
  const period = hours < NOON_HOUR ? '오전' : '오후'
  const displayHour = hours % NOON_HOUR || NOON_HOUR

  return `${period} ${displayHour}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 회의 상세 제목 아래: "2026년 9월 24일 (수) 오후 2:10" */
export const formatMeetingDate = ({ epochMs }: { epochMs: number }) => {
  const date = new Date(epochMs)
  const day = `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`

  return `${day} (${WEEKDAYS[date.getDay()]}) ${formatMeetingTime({ epochMs })}`
}

/** 사이드바 목록: 올해면 "9월 22일", 다른 해면 "2025년 9월 22일" */
export const formatMeetingDay = ({ epochMs, now }: { epochMs: number; now: number }) => {
  const date = new Date(epochMs)
  const monthDay = `${date.getMonth() + 1}월 ${date.getDate()}일`

  return date.getFullYear() === new Date(now).getFullYear()
    ? monthDay
    : `${date.getFullYear()}년 ${monthDay}`
}
