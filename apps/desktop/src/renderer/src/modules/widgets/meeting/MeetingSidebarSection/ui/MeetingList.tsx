import type { Meeting } from '@shared/types'
import Button from '@renderer/shared/components/primitives/ui/Button'
import useNow from '@renderer/shared/hooks/common/useNow'
import { groupMeetingsByDate } from '@renderer/shared/utils/meetingDateGroup'

import MeetingListItem from './MeetingListItem'
import styles from './MeetingList.module.css'

/** 날짜 묶음이 자정을 넘기면 바뀌어야 하므로 1분마다 현재 시각을 새로 읽는다 */
const NOW_REFRESH_MS = 60_000

interface MeetingListProps {
  meetings: Meeting[]
  isLoading: boolean
  error: Error | null
  onRetry: () => void
}

export default function MeetingList({ meetings, isLoading, error, onRetry }: MeetingListProps) {
  const { now } = useNow({ intervalMs: NOW_REFRESH_MS })

  if (isLoading && !meetings.length) return <p className={styles.message}>불러오는 중입니다</p>
  if (error) {
    return (
      <div className={styles.error}>
        <p className={styles.errorMessage}>{error.message}</p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          다시 시도
        </Button>
      </div>
    )
  }
  if (!meetings.length) {
    return <p className={styles.message}>아직 녹음한 회의가 없습니다. 새 녹음으로 시작해 보세요</p>
  }

  return (
    <>
      {groupMeetingsByDate({ meetings, now }).map(({ group, label, meetings: grouped }) => (
        <section key={group} className={styles.group} aria-label={label}>
          <h2 className={styles.heading}>{label}</h2>
          <ul className={styles.list}>
            {grouped.map((meeting) => (
              <li key={meeting.id}>
                <MeetingListItem meeting={meeting} now={now} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}
