// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { PrototypeProcessingItem } from '@shared/prototype'
import Processing from './index'

const { getProcessingApi, getDocumentsApi, getDocumentApi, retryProcessingApi } = vi.hoisted(
  () => ({
    getProcessingApi: vi.fn(),
    getDocumentsApi: vi.fn(async () => []),
    getDocumentApi: vi.fn(),
    retryProcessingApi: vi.fn()
  })
)
vi.mock('@renderer/shared/api/prototype', () => ({
  getProcessingApi,
  getDocumentsApi,
  getDocumentApi,
  retryProcessingApi,
  onPrototypeChanged: () => () => {}
}))
vi.mock('@renderer/modules/widgets/prototype/TranscriptPanel', () => ({
  default: () => <div>원문</div>
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderProcessing(item: PrototypeProcessingItem) {
  getProcessingApi.mockResolvedValue([item])
  getDocumentsApi.mockResolvedValue([])
  return render(
    <MemoryRouter initialEntries={['/processing/meeting-1']}>
      <Routes>
        <Route path="/processing/:meetingId" element={<Processing />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('processing status', () => {
  it('shows active AI processing and the separate storage failure together', async () => {
    renderProcessing({
      meetingId: 'meeting-1',
      title: '회의',
      status: 'running',
      stage: 'summarizing',
      completedStages: ['recording', 'transcribing'],
      hasTranscript: true,
      syncError: 'HTTP 413',
      canRetry: true
    })
    expect(
      await screen.findByRole('heading', { name: '주제별 핵심과 논의 상세를 정리하고 있어요' })
    ).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('서버 보관: HTTP 413')
    expect(screen.getByRole('button', { name: '실패한 단계 다시 시도' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '새 녹음' })).toBeNull()
  })

  it('retains completed stages after AI fails and offers the existing transcript', async () => {
    const { container } = renderProcessing({
      meetingId: 'meeting-1',
      title: '회의',
      status: 'failed',
      stage: 'error',
      error: 'invalid JSON',
      completedStages: ['recording', 'transcribing'],
      hasTranscript: true,
      canRetry: true
    })
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect([...container.querySelectorAll('li')].map((li) => li.getAttribute('data-done'))).toEqual(
      ['true', 'true', 'false', 'false']
    )
    expect(screen.getByRole('button', { name: '전사 원문 보기' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '새 녹음' })).toBeTruthy()
  })

  it('allows a new recording while remote publishing continues after local AI finished', async () => {
    renderProcessing({
      meetingId: 'meeting-1',
      title: '회의',
      status: 'running',
      stage: 'publishing',
      completedStages: ['recording', 'transcribing', 'summarizing'],
      hasTranscript: true
    })
    expect(await screen.findByRole('heading', { name: '주제별 문서를 만들고 있어요' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '새 녹음' })).toBeTruthy()
  })

  it('does not offer an absent transcript merely because processing failed', async () => {
    renderProcessing({
      meetingId: 'meeting-1',
      title: '회의',
      status: 'failed',
      stage: 'error',
      error: '전사 실패',
      completedStages: ['recording'],
      hasTranscript: false,
      canRetry: true
    })
    await screen.findByRole('alert')
    expect(screen.queryByRole('button', { name: '전사 원문 보기' })).toBeNull()
  })

  it('shows generated documents and allows a new recording after local AI completes despite sync failure', async () => {
    getProcessingApi.mockResolvedValue([
      {
        meetingId: 'meeting-1',
        title: '회의',
        status: 'running',
        stage: 'syncing',
        completedStages: ['recording', 'transcribing', 'summarizing'],
        hasTranscript: true,
        saved: false,
        syncError: 'HTTP 503',
        canRetry: true
      }
    ])
    getDocumentsApi.mockResolvedValue([
      {
        id: 'doc-1',
        title: '온보딩',
        latestVersion: 1,
        updatedAt: '2026-09-29T10:00:00Z',
        recordingId: 'meeting-1'
      }
    ] as never)
    getDocumentApi.mockResolvedValue({
      id: 'doc-1',
      title: '온보딩',
      version: 1,
      body: '',
      recordingId: 'meeting-1',
      contributions: []
    })
    render(
      <MemoryRouter initialEntries={['/processing/meeting-1']}>
        <Routes>
          <Route path="/processing/:meetingId" element={<Processing />} />
        </Routes>
      </MemoryRouter>
    )
    expect(await screen.findByText('온보딩')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('서버 보관: HTTP 503')
    expect(screen.getByRole('button', { name: '새 녹음' })).toBeTruthy()
  })

  it('retries the failed stage without acknowledging or paging old recordings', async () => {
    renderProcessing({
      meetingId: 'meeting-1',
      title: '회의',
      status: 'failed',
      stage: 'error',
      error: 'invalid JSON',
      completedStages: ['recording', 'transcribing'],
      canRetry: true
    })
    await userEvent.click(await screen.findByRole('button', { name: '실패한 단계 다시 시도' }))
    expect(retryProcessingApi).toHaveBeenCalledWith('meeting-1')
    expect(screen.queryByText('녹음 이력')).toBeNull()
  })
})
