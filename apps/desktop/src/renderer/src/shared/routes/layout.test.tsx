// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import Documents from '@renderer/pages/Documents'
import DocumentDetail from '@renderer/pages/DocumentDetail'
import { AppShellLayout } from './layout'

const api = vi.hoisted(() => ({
  getDocumentsApi: vi.fn(),
  getDocumentApi: vi.fn(),
  trackApi: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@renderer/shared/api/events', () => ({
  onRecordingState: () => () => {},
  onUpdateAvailable: () => () => {}
}))
vi.mock('@renderer/shared/api/update', () => ({
  downloadUpdateApi: vi.fn(),
  installUpdateApi: vi.fn()
}))
vi.mock('@renderer/shared/api/prototype', () => ({
  getAuthStateApi: async () => ({
    isAuthenticated: true,
    user: { id: 'u', displayName: 'Tester' }
  }),
  getDocumentsApi: api.getDocumentsApi,
  getDocumentApi: api.getDocumentApi,
  getTranscriptApi: vi.fn(),
  trackApi: api.trackApi,
  logoutApi: vi.fn(),
  loginApi: vi.fn(),
  onPrototypeChanged: () => () => {}
}))

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="현재 경로">{location.pathname}</output>
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const defaultDocuments = [
  {
    id: 'doc-1',
    title: '회원 탈퇴 정책',
    domain: '계정',
    overview: '탈퇴한 사용자의 게시글 유지 여부를 정리했다.',
    recordingStartedAt: '2026-09-29T09:00:00Z',
    latestVersion: 1,
    updatedAt: '2026-09-29T10:00:00Z'
  }
]

const defaultDocument = {
  id: 'doc-1',
  title: '회원 탈퇴 정책',
  domain: '계정',
  recordingId: 'meeting-1',
  recordingStartedAt: '2026-09-29T09:00:00Z',
  durationSec: 60,
  version: 1,
  body: '',
  summarySections: [{ heading: '결정', text: '게시글은 유지한다.' }],
  outline: [],
  contributions: []
}

const renderShell = (path: string, withAppRoutes = false) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShellLayout />}>
          {withAppRoutes ? (
            <>
              <Route index element={<Documents />} />
              <Route path="documents/:documentId" element={<DocumentDetail embedded />} />
              <Route path="record" element={<LocationProbe />} />
              <Route path="settings" element={<LocationProbe />} />
              <Route path="*" element={<LocationProbe />} />
            </>
          ) : (
            <Route path="*" element={<LocationProbe />} />
          )}
        </Route>
      </Routes>
    </MemoryRouter>
  )

describe('AppShellLayout navigation', () => {
  it.each([
    ['/documents/doc-1', '문서'],
    ['/processing/meeting-1', '녹음'],
    ['/meetings/meeting-1', '녹음'],
    ['/record', '녹음'],
    ['/settings', '설정']
  ])('keeps the parent menu active at %s', async (path, label) => {
    api.getDocumentsApi.mockResolvedValue([])
    renderShell(path)
    expect(screen.getByRole('link', { name: label }).getAttribute('aria-current')).toBe('page')
    expect(await screen.findByText('Tester')).toBeTruthy()
  })

  it('shows only the approved top-level navigation entries', async () => {
    api.getDocumentsApi.mockResolvedValue([])
    renderShell('/')
    expect(screen.getByRole('navigation', { name: '주 메뉴' }).textContent).toBe('문서녹음설정')
  })

  it('toggles the document sidebar without navigating away from the current route', async () => {
    api.getDocumentsApi.mockResolvedValue([])
    renderShell('/record')
    expect(screen.getByLabelText('현재 경로').textContent).toBe('/record')
    const button = screen.getByRole('button', { name: '문서 사이드바 열기' })
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(document.querySelector('[inert]')).toBeTruthy()

    await userEvent.click(button)

    expect(screen.getByLabelText('현재 경로').textContent).toBe('/record')
    expect(
      screen.getByRole('button', { name: '문서 사이드바 닫기' }).getAttribute('aria-pressed')
    ).toBe('true')
    expect(document.querySelector('[inert]')).toBeNull()
  })

  it('keeps the global sidebar open and category stable from record to document and back to main documents', async () => {
    api.getDocumentsApi.mockResolvedValue(defaultDocuments)
    api.getDocumentApi.mockResolvedValue(defaultDocument)
    renderShell('/record', true)

    await userEvent.click(screen.getByRole('button', { name: '문서 사이드바 열기' }))
    const sidebar = await screen.findByLabelText('문서')
    expect(within(sidebar).getByText('계정')).toBeTruthy()

    await userEvent.click(within(sidebar).getByRole('link', { name: '회원 탈퇴 정책' }))

    expect(await screen.findByText('게시글은 유지한다.')).toBeTruthy()
    expect(screen.getByRole('navigation', { name: '문서 경로' }).textContent).toBe(
      '문서>회원 탈퇴 정책'
    )
    expect(screen.getByRole('button', { name: '문서 사이드바 닫기' })).toBeTruthy()
    expect(screen.getByLabelText('문서')).toBe(sidebar)
    expect(within(sidebar).getByText('계정')).toBeTruthy()

    await userEvent.click(
      within(screen.getByRole('navigation', { name: '주 메뉴' })).getByRole('link', {
        name: '문서'
      })
    )

    expect(await screen.findByRole('region', { name: '문서 목록' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '문서 사이드바 닫기' })).toBeTruthy()
    expect(screen.getByLabelText('문서')).toBe(sidebar)
    expect(within(sidebar).getByText('계정')).toBeTruthy()
  })
})
