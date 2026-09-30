// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'

vi.mock('@renderer/shared/api/prototype', () => ({
  getDocumentApi: vi.fn(),
  getDocumentsApi: vi.fn(),
  getTranscriptApi: vi.fn(),
  trackApi: vi.fn().mockResolvedValue(undefined),
  onPrototypeChanged: vi.fn(() => () => {})
}))
import {
  getDocumentApi,
  getDocumentsApi,
  getTranscriptApi,
  trackApi
} from '@renderer/shared/api/prototype'
import DocumentDetail from './index'
const document = {
  id: 'topic-a',
  title: '회원 탈퇴 정책',
  domain: '계정',
  recordingId: 'r2',
  recordingStartedAt: '2026-09-21T10:00:00Z',
  durationSec: 305,
  version: 2,
  body: '# 회원 탈퇴 정책\n\n## 첫 회의\n기록',
  summarySections: [
    {
      heading: '보관 정책',
      text: '댓글과 첨부파일 보관 정책을 정했다. 댓글과 첨부파일은 탈퇴 뒤에도 보관한다.',
      sourceUtteranceIds: ['u3']
    }
  ],
  outline: [
    {
      heading: '보관 정책',
      items: [{ text: '댓글과 첨부파일은 탈퇴 뒤에도 보관한다.', sourceUtteranceIds: ['u3'] }]
    }
  ],
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
} as never
const catalog = [
  {
    id: 'topic-a',
    title: '회원 탈퇴 정책',
    domain: '계정',
    latestVersion: 2,
    updatedAt: '2026-09-21T10:00:00Z'
  }
] as never
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
describe('주제별 문서', () => {
  it('도메인 트리와 고정 템플릿 없는 통합 문서 흐름을 표시한다', async () => {
    vi.mocked(getDocumentApi).mockResolvedValue(document)
    vi.mocked(getDocumentsApi).mockResolvedValue(catalog)
    localStorage.setItem('knot-transcript-open', 'no')
    mount()
    expect(await screen.findByText('댓글과 첨부파일 보관 정책을 정했다.')).toBeTruthy()
    expect(screen.getByText('내 노트')).toBeTruthy()
    expect(screen.getByText('계정')).toBeTruthy()
    expect(screen.getByRole('link', { name: '회원 탈퇴 정책' }).getAttribute('aria-current')).toBe(
      'page'
    )
    expect(screen.getByText('5분 5초')).toBeTruthy()
    expect(screen.queryByText('2번째 기록')).toBeNull()
    expect(screen.getAllByRole('heading', { name: '보관 정책' })).toHaveLength(1)
    expect(screen.getAllByText('댓글과 첨부파일은 탈퇴 뒤에도 보관한다.')).toHaveLength(1)
    expect(screen.queryByRole('heading', { name: '논의 상세' })).toBeNull()
    expect(screen.queryByText(/2026년 9월 21일/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: /9월 21일/ })).toBeNull()
    expect(screen.queryByText('원문 u3')).toBeNull()
    expect(screen.queryByRole('heading', { name: '확정된 결정' })).toBeNull()
    expect(screen.queryByRole('heading', { name: '미결정 사항' })).toBeNull()
    expect(screen.queryByText(/버전 2/)).toBeNull()
    const transcriptToggle = screen.getByRole('button', { name: '원문 보기' })
    expect(transcriptToggle.getAttribute('title')).toBe('원문 보기')
    expect(transcriptToggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('textbox')).toBeNull()
  })
  it('선택한 회의의 전사 전체를 읽기 전용으로 표시한다', async () => {
    vi.mocked(getDocumentApi).mockResolvedValue(document)
    vi.mocked(getDocumentsApi).mockResolvedValue(catalog)
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
    await screen.findByText('댓글과 첨부파일 보관 정책을 정했다.')
    await userEvent.click(screen.getByRole('button', { name: '이 녹음 원문 보기' }))
    expect(await screen.findByText(/첨부파일도 보관하기로 했습니다/)).toBeTruthy()
    expect(getTranscriptApi).toHaveBeenCalledWith('r2')
    await waitFor(() =>
      expect(trackApi).toHaveBeenCalledWith({ eventType: 'transcript_viewed', recordingId: 'r2' })
    )
    expect(screen.queryByRole('textbox')).toBeNull()
  })
  it('상단 원문 토글로 최신 회의 원문을 열고 닫는다', async () => {
    vi.mocked(getDocumentApi).mockResolvedValue(document)
    vi.mocked(getDocumentsApi).mockResolvedValue(catalog)
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

    await screen.findByText('댓글과 첨부파일 보관 정책을 정했다.')
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

  it('문서가 지정한 정확한 전사 artifact를 원문 패널에 전달한다', async () => {
    vi.mocked(getDocumentApi).mockResolvedValue({
      ...(document as object),
      transcriptArtifactId: 'artifact-r2'
    } as never)
    vi.mocked(getDocumentsApi).mockResolvedValue(catalog)
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
          text: 'artifact에서 읽은 원문입니다.'
        }
      ]
    })
    localStorage.setItem('knot-transcript-open', 'no')
    mount()
    await screen.findByText('댓글과 첨부파일 보관 정책을 정했다.')

    await userEvent.click(screen.getByRole('button', { name: '원문 보기' }))

    expect(await screen.findByText(/artifact에서 읽은 원문입니다/)).toBeTruthy()
    expect(getTranscriptApi).toHaveBeenCalledWith('r2', 'artifact-r2')
  })

  it('존재하지 않는 문서에서 데이터 대신 명확한 오류를 표시한다', async () => {
    vi.mocked(getDocumentApi).mockResolvedValue(null)
    vi.mocked(getDocumentsApi).mockResolvedValue([])
    mount()
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText('댓글과 첨부파일 보관 정책을 정했다.')).toBeNull()
  })
})
