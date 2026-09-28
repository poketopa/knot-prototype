// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { Meeting } from '@shared/types'
import type { PrototypeChangedEvent, PrototypeProcessingItem } from '@shared/prototype'

vi.mock('@renderer/shared/api/meetings', () => ({ getMeetingsApi: vi.fn() }))
vi.mock('@renderer/shared/api/events', () => ({ onMeetingsChanged: vi.fn() }))
vi.mock('@renderer/shared/api/prototype', () => ({
  getProcessingApi: vi.fn(),
  onPrototypeChanged: vi.fn()
}))

import { getMeetingsApi } from '@renderer/shared/api/meetings'
import { onMeetingsChanged } from '@renderer/shared/api/events'
import { getProcessingApi, onPrototypeChanged } from '@renderer/shared/api/prototype'
import RecordingHistorySection from './index'

const meeting: Meeting = {
  id: 'one',
  title: '첫 회의',
  createdAt: new Date(2026, 8, 28, 21, 40).getTime(),
  durationSec: 184.83,
  status: 'done'
}
const job: PrototypeProcessingItem = {
  meetingId: 'one',
  title: meeting.title,
  stage: 'done',
  status: 'succeeded',
  saved: true
}
let onMeetings: () => void
let onPrototype: (event: PrototypeChangedEvent) => void
const unsubscribeMeetings = vi.fn()
const unsubscribePrototype = vi.fn()
const renderHistory = () =>
  render(
    <MemoryRouter initialEntries={['/recordings']}>
      <Routes>
        <Route path="/recordings" element={<RecordingHistorySection />} />
        <Route path="/meetings/one" element={<p>첫 회의 상세</p>} />
      </Routes>
    </MemoryRouter>
  )
beforeEach(() => {
  vi.mocked(getMeetingsApi).mockResolvedValue([meeting])
  vi.mocked(getProcessingApi).mockResolvedValue([job])
  vi.mocked(onMeetingsChanged).mockImplementation((listener) => {
    onMeetings = listener
    return unsubscribeMeetings
  })
  vi.mocked(onPrototypeChanged).mockImplementation((listener) => {
    onPrototype = listener
    return unsubscribePrototype
  })
})
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('녹음 이력', () => {
  it('완료된 녹음도 날짜·길이·보관 상태와 함께 최신순으로 보여주고 상세로 이동한다', async () => {
    vi.mocked(getMeetingsApi).mockResolvedValue([
      meeting,
      {
        ...meeting,
        id: 'two',
        title: '짧은 녹음',
        durationSec: 1,
        createdAt: meeting.createdAt + 1000
      }
    ])
    renderHistory()
    const rows = within(await screen.findByRole('list', { name: '녹음 목록' })).getAllByRole(
      'listitem'
    )
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('짧은 녹음')).toBeTruthy()
    expect(within(rows[0]).getByText('전사 완료')).toBeTruthy()
    expect(within(rows[1]).getByText('정리 완료')).toBeTruthy()
    expect(within(rows[1]).getByText('서버 저장 완료')).toBeTruthy()
    expect(within(rows[1]).getByText(/3분 5초/)).toBeTruthy()
    expect(within(rows[1]).getByText(/2026년 9월 28일/)).toBeTruthy()
    await userEvent.click(within(rows[1]).getByRole('link'))
    expect(screen.getByText('첫 회의 상세')).toBeTruthy()
  })

  it('AI 실패와 서버 저장 대기를 완료로 표시하지 않는다', async () => {
    vi.mocked(getMeetingsApi).mockResolvedValue([
      meeting,
      { ...meeting, id: 'two', title: '다음 회의' }
    ])
    vi.mocked(getProcessingApi).mockResolvedValue([
      { ...job, stage: 'error', status: 'failed', saved: false },
      { ...job, meetingId: 'two', stage: 'syncing', status: 'pending', saved: false }
    ])
    renderHistory()
    expect(await screen.findByText('확인 필요')).toBeTruthy()
    expect(screen.getByText('서버 저장 대기')).toBeTruthy()
    expect(screen.queryByText('서버 저장 완료')).toBeNull()
  })

  it('빈 이력은 녹음을 안내하고, 조회 실패는 재시도할 수 있다', async () => {
    vi.mocked(getMeetingsApi).mockRejectedValueOnce(new Error('read failed')).mockResolvedValue([])
    renderHistory()
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText('아직 녹음한 회의가 없어요')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
    expect(await screen.findByText('아직 녹음한 회의가 없어요')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('녹음과 동기화 변경을 반영하고 화면을 떠나면 구독을 해제한다', async () => {
    vi.mocked(getMeetingsApi).mockResolvedValue([])
    const view = renderHistory()
    await screen.findByText('아직 녹음한 회의가 없어요')
    vi.mocked(getMeetingsApi).mockResolvedValue([meeting])
    vi.mocked(getProcessingApi).mockResolvedValue([{ ...job, saved: false, stage: 'syncing' }])
    await act(async () => {
      onMeetings()
    })
    expect(await screen.findByText('서버 저장 대기')).toBeTruthy()
    vi.mocked(getProcessingApi).mockResolvedValue([job])
    await act(async () => {
      onPrototype({ reason: 'sync' })
    })
    expect(await screen.findByText('서버 저장 완료')).toBeTruthy()
    view.unmount()
    expect(unsubscribeMeetings).toHaveBeenCalledOnce()
    expect(unsubscribePrototype).toHaveBeenCalledOnce()
  })

  it('늦게 도착한 과거 조회가 새 이력을 덮어쓰지 않는다', async () => {
    let resolveOld!: (value: Meeting[]) => void
    vi.mocked(getMeetingsApi).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve
      })
    )
    renderHistory()
    await act(async () => {
      onMeetings()
    })
    expect(await screen.findByText('첫 회의')).toBeTruthy()
    await act(async () => {
      resolveOld([])
    })
    expect(screen.getByText('첫 회의')).toBeTruthy()
    expect(screen.queryByText('아직 녹음한 회의가 없어요')).toBeNull()
  })
})
