import { NavLink } from 'react-router'
import { formatTimestamp } from '@meeting-stt/core/format'
import type { MeetingSearchResult } from '@shared/ipc'
import { meetingDetailPath } from '@renderer/shared/routes/paths'

import { highlightMatch } from '../utils/highlightMatch'
import styles from './SearchResultList.module.css'

/** 사이드바 폭에서 두 줄 안에 들어오는 발화 조각 길이 */
const SNIPPET_MAX_CHARS = 60
const TITLE_MAX_CHARS = 200

interface SearchResultListProps {
  query: string
  results: MeetingSearchResult[]
  isSearching: boolean
  error: Error | null
}

const Highlighted = ({
  text,
  query,
  maxChars
}: {
  text: string
  query: string
  maxChars: number
}) =>
  highlightMatch({ text, query, maxChars }).map((segment, index) =>
    // 조각은 순서로만 구분되고 다시 정렬되지 않는다
    segment.isMatch ? (
      <mark key={index}>{segment.text}</mark>
    ) : (
      <span key={index}>{segment.text}</span>
    )
  )

/** 결과를 누르면 그 회의 상세로 간다. 해당 발화로 스크롤하는 것은 후속 과제다 (references/roadmap.md) */
export default function SearchResultList({
  query,
  results,
  isSearching,
  error
}: SearchResultListProps) {
  if (error) return <p className={styles.error}>{error.message}</p>
  if (isSearching) return <p className={styles.message}>찾는 중입니다</p>
  if (!results.length)
    return <p className={styles.message}>“{query.trim()}”이(가) 들어간 회의가 없습니다</p>

  return (
    <ul className={styles.list}>
      {results.map(({ meeting, match }) => (
        <li key={meeting.id}>
          <NavLink
            to={meetingDetailPath({ meetingId: meeting.id })}
            className={({ isActive }) => [styles.item, isActive ? styles.active : ''].join(' ')}
          >
            <span className={styles.title}>
              <Highlighted text={meeting.title} query={query} maxChars={TITLE_MAX_CHARS} />
            </span>
            {match ? (
              <span className={styles.snippet}>
                <span className={styles.time}>{formatTimestamp({ sec: match.startSec })}</span>{' '}
                <Highlighted text={match.text} query={query} maxChars={SNIPPET_MAX_CHARS} />
              </span>
            ) : null}
          </NavLink>
        </li>
      ))}
    </ul>
  )
}
