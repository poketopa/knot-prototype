// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import Summaries from './index'

const { getSummariesApi, regenerateSummaryApi } = vi.hoisted(() => ({
  getSummariesApi: vi.fn(),
  regenerateSummaryApi: vi.fn()
}))
vi.mock('@renderer/shared/api/prototype', () => ({
  getSummariesApi,
  regenerateSummaryApi,
  onPrototypeChanged: () => () => {}
}))
vi.mock('@renderer/shared/api/events', () => ({ onMeetingsChanged: () => () => {} }))
vi.mock('@renderer/modules/widgets/prototype/TranscriptPanel', () => ({
  default: () => <div>전사 원문 패널</div>
}))

const ready = {
  recordingId: 'meeting-1',
  title: '첫 회의',
  startedAt: '2026-09-29T05:00:00.000Z',
  durationSec: 3600,
  status: 'ready',
  headline: '출시 범위를 정했습니다.',
  body: '앱의 첫 출시 범위를 논의하고 다음 확인 일정을 잡았습니다.',
  hasTranscript: true
}

const showAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/summaries" element={<Summaries />} />
        <Route path="/summaries/:recordingId" element={<Summaries />} />
      </Routes>
    </MemoryRouter>
  )

afterEach(() => {
  cleanup()
  getSummariesApi.mockReset()
  regenerateSummaryApi.mockReset()
})

describe('meeting summaries page', () => {
  it('한 녹음에 한 항목을 보여주고 핵심 요약을 본문보다 먼저 표시한다', async () => {
    getSummariesApi.mockResolvedValue([ready])
    showAt('/summaries')
    expect(await screen.findByRole('link', { name: /첫 회의/ })).toBeTruthy()
    cleanup()
    showAt('/summaries/meeting-1')
    expect(await screen.findByText('출시 범위를 정했습니다.')).toBeTruthy()
    const detail = screen.getByRole('article')
    expect(detail.textContent?.indexOf('핵심 요약')).toBeLessThan(
      detail.textContent?.indexOf('회의 전체 정리') ?? 0
    )
    expect(screen.queryByText('결정 사항')).toBeNull()
  })

  it('내용이 없으면 빈 상태를 분명히 표시한다', async () => {
    getSummariesApi.mockResolvedValue([{ ...ready, status: 'empty', headline: '', body: '' }])
    showAt('/summaries/meeting-1')
    expect(await screen.findByText('정리할 내용이 없습니다.')).toBeTruthy()
  })

  it('새 정리본의 핵심 문단과 논의별 소제목·목록을 읽기 좋게 표시한다', async () => {
    getSummariesApi.mockResolvedValue([
      {
        ...ready,
        headline: '업로드까지 구현합니다.\n\n품질 개선은 별도로 실험합니다.',
        body: '## 녹음 파일 처리\n녹음 종료 후 업로드를 먼저 구현합니다.\n\n## AI 서버 책임\n- WAV 입력을 검토합니다.\n- **전처리 위치**는 조사합니다.'
      }
    ])
    showAt('/summaries/meeting-1')
    expect(await screen.findByRole('heading', { name: '녹음 파일 처리' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'AI 서버 책임' })).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('전처리 위치', { selector: 'strong' })).toBeTruthy()
    expect(screen.getByText('품질 개선은 별도로 실험합니다.')).toBeTruthy()
  })

  it('전사에서 다시 정리하되 기존 결과를 유지하고 중복 클릭을 막는다', async () => {
    getSummariesApi.mockResolvedValue([{ ...ready, refreshStatus: 'running' }])
    showAt('/summaries/meeting-1')
    const button = await screen.findByRole('button', { name: '다시 정리하는 중' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(ready.body)).toBeTruthy()

    cleanup()
    getSummariesApi.mockResolvedValue([ready])
    regenerateSummaryApi.mockResolvedValue(undefined)
    showAt('/summaries/meeting-1')
    fireEvent.click(await screen.findByRole('button', { name: '전사에서 다시 정리하기' }))
    expect(regenerateSummaryApi).toHaveBeenCalledWith('meeting-1')
  })
})
