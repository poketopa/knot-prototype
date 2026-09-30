// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { getDocumentsApi } from '@renderer/shared/api/prototype'
import Documents from './index'

vi.mock('@renderer/shared/api/prototype', () => ({
  getDocumentsApi: vi.fn(),
  onPrototypeChanged: () => () => {}
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
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
})
