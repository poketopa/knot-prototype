// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { getDocumentsApi, getProcessingApi } from '@renderer/shared/api/prototype'
import Documents from './index'

vi.mock('@renderer/shared/api/prototype', () => ({
  getDocumentsApi: vi.fn(),
  getProcessingApi: vi.fn(),
  onPrototypeChanged: () => () => {}
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Documents', () => {
  it('shows a topic overview, saved contribution count and detail link', async () => {
    vi.mocked(getDocumentsApi).mockResolvedValue([
      {
        id: 'doc-1',
        title: '인증',
        overview: 'GitHub 로그인을 사용한다.',
        latestVersion: 3,
        updatedAt: '2026-09-28T10:00:00Z'
      }
    ])
    vi.mocked(getProcessingApi).mockResolvedValue([])
    render(
      <MemoryRouter>
        <Documents />
      </MemoryRouter>
    )
    expect(await screen.findByText('GitHub 로그인을 사용한다.')).toBeTruthy()
    expect(screen.getByText('3회 기록')).toBeTruthy()
    expect(screen.getByRole('link', { name: /인증/ }).getAttribute('href')).toBe('/documents/doc-1')
  })

  it('keeps unsaved recordings visible even when no topic document exists', async () => {
    vi.mocked(getDocumentsApi).mockResolvedValue([])
    vi.mocked(getProcessingApi).mockResolvedValue([
      { meetingId: 'm-1', title: '회의', status: 'succeeded', stage: 'syncing', saved: false }
    ])
    render(
      <MemoryRouter>
        <Documents />
      </MemoryRouter>
    )
    expect(await screen.findByText('첫 번째 결정을 남겨보세요')).toBeTruthy()
    expect(screen.getByRole('link', { name: /회의 서버 저장 대기/ }).getAttribute('href')).toBe(
      '/meetings/m-1'
    )
  })
})
