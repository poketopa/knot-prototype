// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { PrototypeDocumentDetail } from '@shared/prototype'

vi.mock('@renderer/shared/api/prototype', () => ({
  getDocumentApi: vi.fn(),
  getTranscriptApi: vi.fn(),
  trackApi: vi.fn().mockResolvedValue(undefined),
  onPrototypeChanged: vi.fn(() => () => {})
}))
vi.mock('@renderer/shared/api/clipboard', () => ({ writeClipboardTextApi: vi.fn() }))
import { getDocumentApi, getTranscriptApi, trackApi } from '@renderer/shared/api/prototype'
import { writeClipboardTextApi } from '@renderer/shared/api/clipboard'
import DocumentDetail from './index'
const document: PrototypeDocumentDetail = {
  id: 'topic-a',
  title: '회원 탈퇴 정책',
  version: 2,
  body: '# 회원 탈퇴 정책\n\n## 첫 회의\n기록',
  contributions: [
    {
      recordingId: 'r1',
      startedAt: '2026-09-20T10:00:00Z',
      section: {
        overview: '탈퇴 정책을 논의했다.',
        decisions: [{ text: '댓글은 보관한다', sourceUtteranceIds: ['u1'] }],
        unresolved: [{ text: '첨부파일 보관 여부', sourceUtteranceIds: ['u2'] }]
      }
    },
    {
      recordingId: 'r2',
      startedAt: '2026-09-21T10:00:00Z',
      section: {
        overview: '첨부파일을 다시 논의했다.',
        decisions: [{ text: '첨부파일도 보관한다', sourceUtteranceIds: ['u3'] }],
        unresolved: []
      }
    }
  ]
}
const mount = () =>
  render(
    <MemoryRouter initialEntries={['/documents/topic-a']}>
      <Routes>
        <Route path="/documents/:documentId" element={<DocumentDetail />} />
      </Routes>
    </MemoryRouter>
  )
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
})
describe('주제별 누적 문서', () => {
  it('이전 회의의 미결정을 보존하며 다음 회의 결정을 구분하고 전체 Markdown을 복사한다', async () => {
    vi.mocked(getDocumentApi).mockResolvedValue(document)
    vi.mocked(writeClipboardTextApi).mockResolvedValue(undefined)
    localStorage.setItem('knot-transcript-open', 'no')
    mount()
    expect(await screen.findByText('댓글은 보관한다')).toBeTruthy()
    expect(screen.getByText('2회 기록')).toBeTruthy()
    expect(screen.queryByText(/주제별 누적 문서/)).toBeNull()
    expect(screen.queryByText(/버전 2/)).toBeNull()
    const transcriptToggle = screen.getByRole('button', { name: '원문 보기' })
    expect(transcriptToggle.getAttribute('title')).toBe('원문 보기')
    expect(transcriptToggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('첨부파일 보관 여부')).toBeTruthy()
    expect(screen.getByText('첨부파일도 보관한다')).toBeTruthy()
    expect(screen.getAllByRole('heading', { name: '확정된 결정' })).toHaveLength(2)
    expect(screen.queryByRole('textbox')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '복사' }))
    expect(writeClipboardTextApi).toHaveBeenCalledWith({ text: document.body })
    expect(await screen.findByRole('button', { name: '복사됨' })).toBeTruthy()
    expect(trackApi).toHaveBeenCalledWith({
      eventType: 'copied',
      documentId: 'topic-a',
      version: 2
    })
  })
  it('선택한 회의의 전사 전체를 읽기 전용으로 표시한다', async () => {
    vi.mocked(getDocumentApi).mockResolvedValue(document)
    vi.mocked(getTranscriptApi).mockResolvedValue({
      recordingId: 'r1',
      title: '첫 회의',
      startedAt: '2026-09-20T10:00:00Z',
      utterances: [
        {
          id: 'u1',
          meetingId: 'r1',
          ord: 0,
          startSec: 15,
          endSec: 20,
          speakerLabel: 's0',
          text: '댓글은 남겨두기로 합시다.'
        }
      ]
    })
    localStorage.setItem('knot-transcript-open', 'no')
    mount()
    await screen.findByText('댓글은 보관한다')
    await userEvent.click(screen.getAllByRole('button', { name: '이 회의 원문' })[0])
    expect(await screen.findByText(/댓글은 남겨두기로 합시다/)).toBeTruthy()
    expect(getTranscriptApi).toHaveBeenCalledWith('r1')
    await waitFor(() =>
      expect(trackApi).toHaveBeenCalledWith({ eventType: 'transcript_viewed', recordingId: 'r1' })
    )
    expect(screen.queryByRole('textbox')).toBeNull()
  })
  it('상단 원문 토글로 최신 회의 원문을 열고 닫는다', async () => {
    vi.mocked(getDocumentApi).mockResolvedValue(document)
    vi.mocked(getTranscriptApi).mockResolvedValue({
      recordingId: 'r2',
      title: '두 번째 회의',
      startedAt: '2026-09-21T10:00:00Z',
      utterances: [
        {
          id: 'u3',
          meetingId: 'r2',
          ord: 0,
          startSec: 30,
          endSec: 40,
          speakerLabel: 's0',
          text: '첨부파일도 보관하기로 했습니다.'
        }
      ]
    })
    localStorage.setItem('knot-transcript-open', 'no')
    mount()

    await screen.findByText('첨부파일도 보관한다')
    const openButton = screen.getByRole('button', { name: '원문 보기' })
    expect(openButton.getAttribute('title')).toBe('원문 보기')

    await userEvent.click(openButton)

    expect(await screen.findByText(/첨부파일도 보관하기로 했습니다/)).toBeTruthy()
    expect(getTranscriptApi).toHaveBeenCalledWith('r2')
    const closeButton = screen.getByRole('button', { name: '원문 닫기' })
    expect(closeButton.getAttribute('title')).toBe('원문 닫기')
    expect(closeButton.getAttribute('aria-expanded')).toBe('true')

    await userEvent.click(closeButton)

    expect(screen.queryByText(/첨부파일도 보관하기로 했습니다/)).toBeNull()
    expect(screen.getByRole('button', { name: '원문 보기' }).getAttribute('aria-expanded')).toBe(
      'false'
    )
  })

  it('존재하지 않는 문서에서 데이터 대신 명확한 오류를 표시한다', async () => {
    vi.mocked(getDocumentApi).mockResolvedValue(null)
    mount()
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText('댓글은 보관한다')).toBeNull()
  })
})
