// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { PrototypeProcessingItem } from '@shared/prototype'
import Processing from './index'

const { getProcessingApi } = vi.hoisted(() => ({ getProcessingApi: vi.fn() }))
vi.mock('@renderer/shared/api/prototype', () => ({
  getProcessingApi,
  getDocumentsApi: vi.fn(async () => []),
  getDocumentApi: vi.fn(),
  retryProcessingApi: vi.fn(),
  onPrototypeChanged: () => () => {}
}))
vi.mock('@renderer/modules/widgets/prototype/TranscriptPanel', () => ({
  default: () => <div>원문</div>
}))
afterEach(cleanup)

function renderProcessing(item: PrototypeProcessingItem) {
  getProcessingApi.mockResolvedValue([item])
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
      await screen.findByRole('heading', { name: '주제별 결정과 질문을 정리하고 있어요' })
    ).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('서버 보관: HTTP 413')
    expect(screen.getByRole('button', { name: '실패한 단계 다시 시도' })).toBeTruthy()
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
})
