// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { getDocumentApi, getDocumentsApi } from '@renderer/shared/api/prototype'
import Documents from './index'
import DocumentDetail from '@renderer/pages/DocumentDetail'
import DocumentWorkspace from './Workspace'

const prototypeEvents = vi.hoisted(() => ({
  listener: null as null | ((event: { reason: string }) => void)
}))

vi.mock('@renderer/shared/api/prototype', () => ({
  getDocumentsApi: vi.fn(),
  getDocumentApi: vi.fn(),
  getTranscriptApi: vi.fn(),
  trackApi: vi.fn().mockResolvedValue(undefined),
  onPrototypeChanged: vi.fn((listener: (event: { reason: string }) => void) => {
    prototypeEvents.listener = listener
    return () => {}
  })
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  prototypeEvents.listener = null
})

const renderWorkspace = (initialEntries = ['/']) =>
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route element={<DocumentWorkspace sidebarOpen />}>
          <Route index element={<Documents />} />
          <Route path="/documents/:documentId" element={<DocumentDetail embedded />} />
        </Route>
      </Routes>
    </MemoryRouter>
  )

describe('Documents', () => {
  it('renders grouped document cards sorted by latest recording time', async () => {
    vi.mocked(getDocumentsApi).mockResolvedValue([
      {
        id: 'doc-1',
        title: '인증',
        domain: '계정',
        recordingId: 'meeting-1',
        recordingStartedAt: '2026-09-28T09:00:00Z',
        durationSec: 65,
        overview: 'GitHub 로그인을 사용한다. 세부 구현은 유지한다.',
        latestVersion: 3,
        updatedAt: '2026-09-28T10:00:00Z'
      },
      {
        id: 'doc-2',
        title: '결제',
        domain: '수익',
        recordingStartedAt: '2026-09-29T10:00:00Z',
        durationSec: 3600,
        latestVersion: 1,
        updatedAt: '2026-09-27T10:00:00Z'
      }
    ] as never)
    renderWorkspace()

    expect(await screen.findByText('녹음하고 정리한 내용을 폴더별로 모아둬요.')).toBeTruthy()
    const list = screen.getByRole('region', { name: '문서 목록' })
    const headings = within(list)
      .getAllByRole('heading', { level: 2 })
      .map((node) => node.textContent)
    expect(headings).toEqual(['수익', '계정'])
    expect(within(list).getByRole('link', { name: /인증/ }).getAttribute('href')).toBe(
      '/documents/doc-1'
    )
    expect(within(list).getByText('GitHub 로그인을 사용한다.')).toBeTruthy()
    expect(within(list).queryByText(/세부 구현은 유지한다/)).toBeNull()
    expect(within(list).getByText(/1분 5초/)).toBeTruthy()
    expect(within(list).getByText(/1시간 0분 0초/)).toBeTruthy()
  })

  it('shows a meaningful empty state without a previous recording list', async () => {
    vi.mocked(getDocumentsApi).mockResolvedValue([])
    renderWorkspace()
    expect(await screen.findByText('아직 기록된 문서가 없습니다')).toBeTruthy()
    expect(screen.queryByText('녹음 이력')).toBeNull()
    expect(screen.getByRole('link', { name: '새 녹음 시작' }).getAttribute('href')).toBe('/record')
  })

  it('keeps the document tree mounted while navigating to a document detail', async () => {
    vi.mocked(getDocumentsApi).mockResolvedValue([
      {
        id: 'doc-1',
        title: '회원 탈퇴 정책',
        domain: '계정',
        recordingId: 'meeting-1',
        recordingStartedAt: '2026-09-28T09:00:00Z',
        overview: '탈퇴 정책을 정리했다.',
        latestVersion: 1,
        updatedAt: '2026-09-28T10:00:00Z'
      }
    ] as never)
    vi.mocked(getDocumentApi).mockResolvedValue({
      id: 'doc-1',
      title: '회원 탈퇴 정책',
      domain: '계정',
      recordingId: 'meeting-1',
      recordingStartedAt: '2026-09-28T09:00:00Z',
      durationSec: 120,
      version: 1,
      body: '',
      summarySections: [{ heading: '결정', text: '탈퇴한 사용자의 글은 유지한다.' }],
      outline: [],
      contributions: []
    } as never)
    renderWorkspace()
    const sidebar = await screen.findByLabelText('문서')
    sidebar.scrollTop = 180

    await userEvent.click(within(sidebar).getByRole('link', { name: /회원 탈퇴 정책/ }))

    expect(await screen.findByText('탈퇴한 사용자의 글은 유지한다.')).toBeTruthy()
    expect(screen.getByLabelText('문서')).toBe(sidebar)
    expect(sidebar.scrollTop).toBe(180)
    expect(getDocumentsApi).toHaveBeenCalledTimes(1)
  })

  it('clears the current catalog immediately when auth changes', async () => {
    vi.mocked(getDocumentsApi)
      .mockResolvedValueOnce([
        {
          id: 'old-doc',
          title: '이전 계정 문서',
          domain: '문서',
          latestVersion: 1,
          updatedAt: '2026-09-28T10:00:00Z'
        }
      ] as never)
      .mockReturnValueOnce(new Promise(() => {}) as never)
    renderWorkspace()
    const sidebar = await screen.findByLabelText('문서')
    expect(within(sidebar).getByRole('link', { name: /이전 계정 문서/ })).toBeTruthy()

    prototypeEvents.listener?.({ reason: 'auth' })

    await waitFor(() =>
      expect(within(sidebar).queryByRole('link', { name: /이전 계정 문서/ })).toBeNull()
    )
    expect(getDocumentsApi).toHaveBeenCalledTimes(2)
  })

  it('keeps existing document rows and sidebar scroll while a document refresh is in flight', async () => {
    vi.mocked(getDocumentsApi)
      .mockResolvedValueOnce([
        {
          id: 'doc-1',
          title: '문서 분류 정책',
          domain: '문서',
          overview: '큰 폴더 기준을 유지한다.',
          latestVersion: 1,
          updatedAt: '2026-09-30T10:00:00Z'
        }
      ] as never)
      .mockReturnValueOnce(new Promise(() => {}) as never)
    renderWorkspace()
    const sidebar = await screen.findByLabelText('문서')
    sidebar.scrollTop = 220
    expect(screen.getByRole('region', { name: '문서 목록' })).toBeTruthy()

    prototypeEvents.listener?.({ reason: 'documents' })

    const list = screen.getByRole('region', { name: '문서 목록' })
    expect(within(list).getByRole('link', { name: /문서 분류 정책/ })).toBeTruthy()
    expect(screen.queryByText('문서를 불러오고 있어요.')).toBeNull()
    expect(screen.getByLabelText('문서')).toBe(sidebar)
    expect(sidebar.scrollTop).toBe(220)
  })
})
