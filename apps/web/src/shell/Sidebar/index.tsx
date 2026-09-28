import { useState } from 'react'
import { NavLink } from 'react-router'

import { formatTimestamp } from '@meeting-stt/core/format'

import Icon from '../../components/Icon'
import ProgressBar from '../../components/ProgressBar'
import { formatDurationWords, formatRelativeDay } from '../../lib/dateFormat'
import { PATHS, meetingPath } from '../../routes/paths'
import { useJob } from '../../state/jobContext'
import { useMeetings } from '../../state/meetingsContext'
import { useRecording } from '../../state/recordingContext'
import type { MeetingRecord } from '../../types/meeting'
import { filterMeetings } from './filterMeetings'
import styles from './index.module.css'

const statusCaption = (meeting: MeetingRecord) => {
  if (meeting.status === 'error') return '오류 · 다시 만들 수 있음'
  if (meeting.status === 'recorded') return '녹음만 저장됨 · 회의록 만들기 전'

  return `${formatRelativeDay({ timestampMs: meeting.createdAt })} · ${formatDurationWords(meeting.durationSec)}`
}

function NewRecordingButton() {
  const { isRecording, elapsedSec } = useRecording()
  const { job } = useJob()

  if (isRecording) {
    return (
      <NavLink to={PATHS.record} className={styles.recordingLink}>
        <span className={styles.recordingDot} aria-hidden="true" />
        <span className={styles.grow}>녹음 중</span>
        <span className={styles.recordingTime}>
          {formatTimestamp({ sec: elapsedSec }).slice(3)}
        </span>
      </NavLink>
    )
  }

  if (job) {
    return (
      <button type="button" className={styles.newButton} disabled>
        <Icon name="mic" />
        <span className={styles.grow}>처리 중에는 녹음할 수 없음</span>
      </button>
    )
  }

  return (
    <NavLink to={PATHS.home} className={styles.newLink}>
      <Icon name="mic" />
      <span className={styles.grow}>새 녹음</span>
    </NavLink>
  )
}

export default function Sidebar() {
  const [query, setQuery] = useState('')
  const { meetings, isLoaded } = useMeetings()
  const { job } = useJob()
  const results = filterMeetings({ meetings, query })
  const isSearching = query.trim() !== ''

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.brand}>회의록</span>
        <span className={styles.webBadge}>웹</span>
      </div>

      <div className={styles.controls}>
        <NewRecordingButton />
        <label className={styles.search}>
          <Icon name="search" size={15} />
          <input
            type="search"
            className={styles.searchInput}
            placeholder="기록 검색"
            aria-label="기록 검색"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setQuery('')
            }}
          />
        </label>
      </div>

      <nav aria-label="이전 기록" className={styles.list}>
        <div className={styles.listTitle}>
          {isSearching ? `검색 결과 ${results.length}` : '이 브라우저에 저장된 기록'}
        </div>
        {isLoaded && meetings.length === 0 ? (
          <p className={styles.empty}>아직 저장된 기록이 없습니다</p>
        ) : null}
        {results.map(({ meeting, snippet }) => (
          <NavLink
            key={meeting.id}
            to={meetingPath(meeting.id)}
            className={({ isActive }) => (isActive ? styles.itemActive : styles.item)}
          >
            <span className={styles.itemTitle}>{meeting.title}</span>
            <span className={styles.itemCaption}>
              {job?.meetingId === meeting.id ? '처리 중' : statusCaption(meeting)}
            </span>
            {snippet ? (
              <span className={styles.itemSnippet}>
                {snippet.before}
                <mark>{snippet.match}</mark>
                {snippet.after}
              </span>
            ) : null}
            {job?.meetingId === meeting.id ? (
              <span className={styles.itemProgress}>
                <ProgressBar percent={job.overallPercent} label="회의록 만드는 중" />
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>

      <div className={styles.footer}>
        녹음과 회의록은 이 브라우저에만 저장됩니다. 사이트 데이터를 지우면 함께 사라집니다.
      </div>
    </aside>
  )
}
