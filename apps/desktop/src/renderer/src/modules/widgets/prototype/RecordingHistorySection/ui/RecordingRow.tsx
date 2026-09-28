import { Link } from 'react-router'
import type { Meeting } from '@shared/types'
import type { PrototypeProcessingItem, PrototypeProcessingStage } from '@shared/prototype'
import { meetingDetailPath } from '@renderer/shared/routes/paths'
import { formatDuration } from '@renderer/shared/utils/formatDuration'
import styles from '@renderer/modules/widgets/prototype/RecordingHistorySection/index.module.css'

interface RecordingRowProps {
  meeting: Meeting
  job?: PrototypeProcessingItem
}

const STAGE_LABELS: Record<PrototypeProcessingStage, string> = {
  recording: '녹음 중',
  transcribing: '전사 중',
  summarizing: 'AI 정리 중',
  publishing: '문서 저장 중',
  syncing: '서버 저장 대기',
  done: '정리 완료',
  error: '확인 필요'
}
const MEETING_LABELS = {
  recording: '녹음 중',
  processing: '전사 중',
  done: '전사 완료',
  error: '확인 필요'
}

export default function RecordingRow({ meeting, job }: RecordingRowProps) {
  const isFailed = job
    ? job.status === 'failed' || job.stage === 'error'
    : meeting.status === 'error'
  const status = isFailed
    ? '확인 필요'
    : job
      ? STAGE_LABELS[job.stage]
      : MEETING_LABELS[meeting.status]
  const date = new Date(meeting.createdAt)
  return (
    <li>
      <Link className={styles.row} to={meetingDetailPath({ meetingId: meeting.id })}>
        <div className={styles.details}>
          <h2>{meeting.title}</h2>
          <p>
            <time dateTime={date.toISOString()}>
              {date.toLocaleString('ko-KR', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </time>
            {' · '}
            {meeting.status === 'recording'
              ? '녹음 진행 중'
              : formatDuration({ sec: meeting.durationSec })}
          </p>
        </div>
        <div className={styles.state}>
          <span className={styles.badge} data-error={isFailed}>
            {status}
          </span>
          <small>{job?.saved ? '서버 저장 완료' : '서버 저장 미완료'}</small>
          <small>상세 보기 →</small>
        </div>
      </Link>
    </li>
  )
}
