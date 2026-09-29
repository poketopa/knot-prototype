// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import Summaries from './index'

const { getSummariesApi } = vi.hoisted(() => ({ getSummariesApi: vi.fn() }))
vi.mock('@renderer/shared/api/prototype', () => ({
  getSummariesApi,
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
})
