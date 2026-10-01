import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, matchPath, useLocation, useNavigate } from 'react-router'
import UpdateBanner from '@renderer/modules/features/update/UpdateBanner'
import DocumentWorkspace from '@renderer/pages/Documents/Workspace'
import { onRecordingState } from '@renderer/shared/api/events'
import {
  getAuthStateApi,
  logoutApi,
  loginApi,
  onPrototypeChanged
} from '@renderer/shared/api/prototype'
import type { PrototypeAuthState } from '@shared/prototype'
import { PATHS, processingPath } from './paths'
import styles from './layout.module.css'

export function MainWindowLayout() {
  const navigate = useNavigate()
  useEffect(
    () =>
      onRecordingState(({ stoppedMeetingId }) => {
        if (stoppedMeetingId) navigate(processingPath({ meetingId: stoppedMeetingId }))
      }),
    [navigate]
  )
  return <Outlet />
}

export function AppShellLayout() {
  const { pathname } = useLocation()
  const isDocument = pathname === PATHS.home || !!matchPath(PATHS.documentDetail, pathname)
  const isRecord =
    pathname === PATHS.record ||
    !!matchPath(PATHS.processing, pathname) ||
    !!matchPath(PATHS.meetingDetail, pathname)
  const [auth, setAuth] = useState<PrototypeAuthState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDocumentSidebarOpen, setIsDocumentSidebarOpen] = useState(false)
  useEffect(() => {
    let isMounted = true
    const refresh = () =>
      getAuthStateApi()
        .then((value) => {
          if (isMounted) setAuth(value)
        })
        .catch(() => {})
    void refresh()
    const unsubscribe = onPrototypeChanged(({ reason }) => {
      if (reason === 'auth') void refresh()
    })
    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [])
  const logout = async () => {
    try {
      await logoutApi()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <button
          className={`${styles.brand} ${isDocumentSidebarOpen ? styles.brandOpen : ''}`}
          type="button"
          aria-label={isDocumentSidebarOpen ? '문서 사이드바 닫기' : '문서 사이드바 열기'}
          aria-pressed={isDocumentSidebarOpen}
          title={isDocumentSidebarOpen ? '문서 사이드바 닫기' : '문서 사이드바 열기'}
          onClick={() => setIsDocumentSidebarOpen((value) => !value)}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <path d="M9 6h12M9 12h12M9 18h12" />
            <path d="M3 6h1M3 12h1M3 18h1" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </button>
        <nav className={styles.nav} aria-label="주 메뉴">
          <Link to={PATHS.home} aria-current={isDocument ? 'page' : undefined}>
            문서
          </Link>
          <Link to={PATHS.record} aria-current={isRecord ? 'page' : undefined}>
            녹음
          </Link>
          <NavLink to={PATHS.settings}>설정</NavLink>
        </nav>
        <details className={styles.account}>
          <summary aria-label="계정 메뉴" title={auth?.user?.displayName ?? '계정 메뉴'}>
            {auth?.user?.displayName?.slice(0, 1).toUpperCase() ?? '나'}
          </summary>
          <div className={styles.accountMenu}>
            <span>{auth?.user?.displayName}</span>
            <button onClick={() => void logout()}>로그아웃</button>
          </div>
        </details>
      </header>
      {auth?.isSyncPaused && (
        <div className={styles.notice}>
          서버 동기화가 중지되어 있습니다. 로컬 자료는 보관 중입니다.{' '}
          <button onClick={() => void loginApi().catch((e: unknown) => setError(String(e)))}>
            다시 로그인
          </button>
        </div>
      )}
      {error && (
        <div className={styles.notice} role="alert">
          {error}
          <button onClick={() => setError(null)}>닫기</button>
        </div>
      )}
      <UpdateBanner />
      <main className={styles.main}>
        <DocumentWorkspace sidebarOpen={isDocumentSidebarOpen}>
          <Outlet />
        </DocumentWorkspace>
      </main>
    </div>
  )
}
