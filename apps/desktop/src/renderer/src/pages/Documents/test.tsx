// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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

describe('Documents', () => {
  it('groups documents by reusable domain and links leaves to document detail', async () => {
    vi.mocked(getDocumentsApi).mockResolvedValue([
      {
        id: 'doc-1',
        title: '인증',
        domain: '계정',
        recordingId: 'meeting-1',
        recordingStartedAt: '2026-09-28T09:00:00Z',
        overview: 'GitHub 로그인을 사용한다.',
        latestVersion: 3,
        updatedAt: '2026-09-28T10:00:00Z'
      },
      {
        id: 'doc-2',
        title: '결제',
        domain: '수익',
        latestVersion: 1,
        updatedAt: '2026-09-27T10:00:00Z'
      }
    ] as never)
    render(
      <MemoryRouter>
        <Documents />
      </MemoryRouter>
    )
    expect(await screen.findByText('계정')).toBeTruthy()
    expect(screen.getByText('수익')).toBeTruthy()
    expect(screen.getByRole('link', { name: /인증/ }).getAttribute('href')).toBe('/documents/doc-1')
    expect(screen.getByText(/왼쪽에서 문서를 선택하세요/)).toBeTruthy()
  })

  it('shows a meaningful empty state without a previous recording list', async () => {
    vi.mocked(getDocumentsApi).mockResolvedValue([])
    render(
      <MemoryRouter>
        <Documents />
      </MemoryRouter>
    )
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
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<DocumentWorkspace />}>
            <Route index element={<Documents />} />
            <Route path="/documents/:documentId" element={<DocumentDetail embedded />} />
          </Route>
        </Routes>
      </MemoryRouter>
    )
    const sidebar = await screen.findByLabelText('문서')
    sidebar.scrollTop = 180

    await userEvent.click(screen.getByRole('link', { name: /회원 탈퇴 정책/ }))

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
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<DocumentWorkspace />}>
            <Route index element={<Documents />} />
          </Route>
        </Routes>
      </MemoryRouter>
    )
    expect(await screen.findByRole('link', { name: /이전 계정 문서/ })).toBeTruthy()

    prototypeEvents.listener?.({ reason: 'auth' })

    await waitFor(() => expect(screen.queryByRole('link', { name: /이전 계정 문서/ })).toBeNull())
    expect(getDocumentsApi).toHaveBeenCalledTimes(2)
  })
})
