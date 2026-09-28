import type { Meeting } from '@shared/types'

export type MeetingDateGroup = 'today' | 'week' | 'earlier'

export const MEETING_DATE_GROUP_LABELS: Record<MeetingDateGroup, string> = {
  today: '오늘',
  week: '이번 주',
  earlier: '이전'
}

/** 오늘을 빼고 며칠 전까지를 "이번 주"로 묶는지. 달력 주가 아니라 최근 7일이다 — 월요일 아침에 어제 회의가 "이전"으로 밀리지 않는다 */
const RECENT_DAYS = 6
const MS_PER_DAY = 86_400_000

const startOfDay = (epochMs: number) => {
  const date = new Date(epochMs)

  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

interface MeetingDateGroupOfParams {
  epochMs: number
  /** 테스트할 수 있도록 현재 시각을 주입받는다 */
  now: number
}

/** 현지 달력 날짜 기준. 시계가 어긋나 미래 시각이 오면 오늘로 본다 */
export const meetingDateGroupOf = ({
  epochMs,
  now
}: MeetingDateGroupOfParams): MeetingDateGroup => {
  const today = startOfDay(now)
  if (epochMs >= today) return 'today'
  if (epochMs >= today - RECENT_DAYS * MS_PER_DAY) return 'week'

  return 'earlier'
}

interface GroupMeetingsByDateParams {
  meetings: Meeting[]
  now: number
}

/** 최신순 목록을 날짜 묶음으로 나눈다. 빈 묶음은 빼고, 묶음 안의 순서는 그대로 둔다 */
export const groupMeetingsByDate = ({ meetings, now }: GroupMeetingsByDateParams) => {
  const order: MeetingDateGroup[] = ['today', 'week', 'earlier']

  return order
    .map((group) => ({
      group,
      label: MEETING_DATE_GROUP_LABELS[group],
      meetings: meetings.filter(
        (meeting) => meetingDateGroupOf({ epochMs: meeting.createdAt, now }) === group
      )
    }))
    .filter(({ meetings: grouped }) => grouped.length > 0)
}
