// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { PrototypeProcessingItem } from '@shared/prototype'
import Processing, { ProcessingContent } from './index'

const {
  getProcessingApi,
  getDocumentsApi,
  getDocumentApi,
  getComparisonApi,
  chooseComparisonApi,
  retryProcessingApi
} = vi.hoisted(() => ({
  getProcessingApi: vi.fn(),
  getDocumentsApi: vi.fn(async () => []),
  getDocumentApi: vi.fn(),
  getComparisonApi: vi.fn(),
  chooseComparisonApi: vi.fn(),
  retryProcessingApi: vi.fn()
}))
vi.mock('@renderer/shared/api/prototype', () => ({
  getProcessingApi,
  getDocumentsApi,
  getDocumentApi,
  getComparisonApi,
  chooseComparisonApi,
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

const topicOf = (title: string, sectionText: string, outlineText: string) => ({
  documentId: `${title}-doc`,
  domain: title,
  title,
  summarySections: [{ heading: '핵심 요약', text: sectionText, sourceUtteranceIds: ['u1'] }],
  outline: [{ heading: '결정', items: [{ text: outlineText, sourceUtteranceIds: ['u2'] }] }]
})

function renderChoosing() {
  getProcessingApi.mockResolvedValue([
    {
      meetingId: 'meeting-1',
      title: '회의',
      status: 'pending',
      stage: 'choosing',
      completedStages: ['recording', 'transcribing', 'summarizing'],
      hasTranscript: true
    }
  ])
  getComparisonApi.mockResolvedValue({
    firstVariant: 'B',
    candidates: [
      { variant: 'A', topics: [topicOf('A쪽 내부 제목', 'A쪽 요약', 'A쪽 결정')] },
      { variant: 'B', topics: [topicOf('고객 온보딩', '고객 온보딩 요약', '다음 주 배포한다')] }
    ],
    selection: null
  })
  if (!chooseComparisonApi.getMockImplementation()) chooseComparisonApi.mockResolvedValue(undefined)
  return render(
    <MemoryRouter initialEntries={['/processing/meeting-1']}>
      <Routes>
        <Route path="/processing/:meetingId" element={<Processing />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('processing status', () => {
  it('returns to the recorder when the route sees server save completed', async () => {
    getProcessingApi.mockResolvedValue([
      { meetingId: 'meeting-1', title: '회의', stage: 'done', status: 'succeeded', saved: true }
    ])
    render(
      <MemoryRouter initialEntries={['/processing/meeting-1']}>
        <Routes>
          <Route path="/processing/:meetingId" element={<Processing />} />
          <Route path="/record" element={<div>녹음 시작 화면</div>} />
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findByText('녹음 시작 화면')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '정리가 끝났어요' })).toBeNull()
  })

  it('keeps the route on the retryable screen while server save has not completed', async () => {
    renderProcessing({
      meetingId: 'meeting-1',
      title: '회의',
      status: 'running',
      stage: 'syncing',
      completedStages: ['recording', 'transcribing', 'summarizing'],
      hasTranscript: true,
      saved: false,
      syncError: 'HTTP 503',
      canRetry: true
    })

    expect(
      await screen.findByRole('heading', { name: '서버에 원본을 보관하고 있어요' })
    ).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('서버 보관: HTTP 503')
    expect(screen.getByRole('button', { name: '실패한 단계 다시 시도' })).toBeTruthy()
  })

  it('does not claim an empty result while generated documents are still loading', async () => {
    let resolveDocuments!: (documents: never[]) => void
    getProcessingApi.mockResolvedValue([
      { meetingId: 'meeting-1', title: '회의', stage: 'done', status: 'succeeded', saved: true }
    ])
    getDocumentsApi.mockReturnValue(new Promise((resolve) => (resolveDocuments = resolve)))
    render(
      <MemoryRouter>
        <ProcessingContent meetingId="meeting-1" />
      </MemoryRouter>
    )
    await screen.findByRole('heading', { name: '정리가 끝났어요' })
    expect(screen.queryByText(/추가할 주제별 논의가 없습니다/)).toBeNull()
    resolveDocuments([])
    expect(await screen.findByText(/추가할 주제별 논의가 없습니다/)).toBeTruthy()
  })

  it('does not treat a document request failure as an empty result', async () => {
    getProcessingApi.mockResolvedValue([
      { meetingId: 'meeting-1', title: '회의', stage: 'done', status: 'succeeded', saved: true }
    ])
    getDocumentsApi.mockRejectedValue(new Error('문서를 불러오지 못했습니다'))
    render(
      <MemoryRouter>
        <ProcessingContent meetingId="meeting-1" />
      </MemoryRouter>
    )
    expect((await screen.findByRole('alert')).textContent).toContain('문서를 불러오지 못했습니다')
    expect(screen.queryByText(/추가할 주제별 논의가 없습니다/)).toBeNull()
  })

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

  it('marks back and new recording actions as explicit recorder entries', async () => {
    renderProcessing({
      meetingId: 'meeting-1',
      title: '회의',
      status: 'running',
      stage: 'publishing',
      completedStages: ['recording', 'transcribing', 'summarizing'],
      hasTranscript: true
    })

    expect((await screen.findByRole('link', { name: '‹ 녹음' })).getAttribute('href')).toBe(
      '/record?new=1'
    )
    await userEvent.click(screen.getByRole('button', { name: '새 녹음' }))
    expect(window.location.hash).toBe('#/record?new=1')
  })

  it('shows blinded A/B topic bundles in the stored random order', async () => {
    renderChoosing()

    expect(
      await screen.findByRole('heading', { name: '더 마음에 드는 정리를 골라 주세요' })
    ).toBeTruthy()
    const choices = screen.getAllByText(/정리 [12]/).map((node) => node.textContent)
    expect(choices).toEqual(['정리 1', '정리 2'])
    expect(screen.getByText('고객 온보딩')).toBeTruthy()
    expect(screen.getByText('고객 온보딩 요약')).toBeTruthy()
    expect(screen.getByText('다음 주 배포한다')).toBeTruthy()
    expect(screen.getByText('A쪽 내부 제목')).toBeTruthy()
    expect(screen.queryByText('A')).toBeNull()
    expect(screen.queryByText('B')).toBeNull()
  })

  it('requires a candidate, reason, and meeting type before publishing the chosen summary', async () => {
    const user = userEvent.setup()
    renderChoosing()

    const submit = await screen.findByRole('button', { name: '선택한 정리 발행' })
    expect(submit.hasAttribute('disabled')).toBe(true)

    await user.click(screen.getByLabelText('정리 1'))
    await user.click(screen.getByLabelText('결정·할 일이 더 잘 보여'))
    expect(submit.hasAttribute('disabled')).toBe(true)

    await user.click(screen.getByLabelText('여러 안건 회의'))
    expect(submit.hasAttribute('disabled')).toBe(false)
    await user.click(submit)

    expect(chooseComparisonApi).toHaveBeenCalledWith({
      recordingId: 'meeting-1',
      selectedVariant: 'B',
      reason: 'decisions_actions',
      meetingType: 'multi_agenda'
    })
  })

  it('surfaces comparison submission errors without dropping the form', async () => {
    const user = userEvent.setup()
    chooseComparisonApi.mockRejectedValue(new Error('이미 선택했습니다'))
    renderChoosing()

    await screen.findByRole('heading', { name: '더 마음에 드는 정리를 골라 주세요' })
    await user.click(screen.getByLabelText('정리 2'))
    await user.click(screen.getByLabelText('기타'))
    await user.type(screen.getByPlaceholderText('이유를 적어 주세요'), '구조가 낫다')
    await user.click(screen.getByLabelText('인터뷰·피드백'))
    await user.click(screen.getByRole('button', { name: '선택한 정리 발행' }))

    expect((await screen.findByRole('alert')).textContent).toContain('이미 선택했습니다')
    expect(chooseComparisonApi).toHaveBeenCalledWith({
      recordingId: 'meeting-1',
      selectedVariant: 'A',
      reason: 'other',
      meetingType: 'interview_feedback',
      otherReason: '구조가 낫다'
    })
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
