import { NavLink } from 'react-router'
import type { Meeting } from '@shared/types'
import PipelineProgress from '@renderer/modules/features/pipeline/PipelineProgress'
import { meetingDetailPath } from '@renderer/shared/routes/paths'
import { formatDurationShort } from '@renderer/shared/utils/formatDuration'
import { formatMeetingDay, formatMeetingTime } from '@renderer/shared/utils/formatMeetingDate'
import { meetingDateGroupOf } from '@renderer/shared/utils/meetingDateGroup'

import styles from './MeetingListItem.module.css'

interface MeetingListItemProps {
  meeting: Meeting
  now: number
}

const DEFAULT_ERROR_MESSAGE = '회의록을 만들지 못했습니다'

/** 오늘 회의는 시각을, 그 전 회의는 날짜를 보여 준다 */
const whenOf = ({ meeting, now }: MeetingListItemProps) =>
  meetingDateGroupOf({ epochMs: meeting.createdAt, now }) === 'today'
    ? formatMeetingTime({ epochMs: meeting.createdAt })
    : formatMeetingDay({ epochMs: meeting.createdAt, now })

export default function MeetingListItem({ meeting, now }: MeetingListItemProps) {
  const renderStatus = () => {
    if (meeting.status === 'recording') return <span className={styles.recording}>녹음 중</span>
    if (meeting.status === 'processing') return <PipelineProgress meetingId={meeting.id} />
    if (meeting.status === 'error') {
      return <span className={styles.error}>{meeting.errorMessage ?? DEFAULT_ERROR_MESSAGE}</span>
    }

    return (
      <span className={styles.meta}>
        {whenOf({ meeting, now })} · {formatDurationShort({ sec: meeting.durationSec })}
      </span>
    )
  }

  return (
    <NavLink
      to={meetingDetailPath({ meetingId: meeting.id })}
      className={({ isActive }) => [styles.item, isActive ? styles.active : ''].join(' ')}
    >
      <span className={styles.title}>{meeting.title}</span>
      {renderStatus()}
    </NavLink>
  )
}
