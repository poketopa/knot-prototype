import { useState } from 'react'
import { NavLink } from 'react-router'
import Icon from '@renderer/shared/components/primitives/ui/Icon'
import useMeetings from '@renderer/shared/hooks/domain/meeting/useMeetings'
import useMeetingSearch from '@renderer/shared/hooks/domain/meeting/useMeetingSearch'
import { PATHS } from '@renderer/shared/routes/paths'

import MeetingList from './ui/MeetingList'
import NewRecordingButton from './ui/NewRecordingButton'
import SearchField from './ui/SearchField'
import SearchResultList from './ui/SearchResultList'
import styles from './index.module.css'

/**
 * 메인 창 왼쪽 사이드바. 화면을 옮겨도 언마운트되지 않으므로 목록은 `meetings:changed`로 갱신한다
 * (references/architecture.md "메인 창과 사이드바 레이아웃").
 */
export default function MeetingSidebarSection() {
  const [query, setQuery] = useState('')
  const { meetings, isLoading, error, refetch } = useMeetings()
  const search = useMeetingSearch({ query })

  return (
    <aside className={styles.sidebar}>
      {/* 신호등이 겹치는 자리. 창을 끄는 영역이다 */}
      <div className={styles.titleBar} />
      <div className={styles.header}>
        <NewRecordingButton />
        <SearchField value={query} onChange={setQuery} />
      </div>
      <nav className={styles.body} aria-label={search.isActive ? '검색 결과' : '회의 목록'}>
        {search.isActive ? (
          <SearchResultList
            query={query}
            results={search.results}
            isSearching={search.isSearching}
            error={search.error}
          />
        ) : (
          <MeetingList meetings={meetings} isLoading={isLoading} error={error} onRetry={refetch} />
        )}
      </nav>
      <div className={styles.footer}>
        <NavLink
          to={PATHS.settings}
          className={({ isActive }) =>
            [styles.settingsLink, isActive ? styles.active : ''].join(' ')
          }
        >
          <Icon name="settings" />
          설정
        </NavLink>
      </div>
    </aside>
  )
}
