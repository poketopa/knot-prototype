// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { PrototypeProcessingItem } from '@shared/prototype'
import Record from './index'

const { getProcessingApi, getRecordingStateApi } = vi.hoisted(() => ({
  getProcessingApi: vi.fn<() => Promise<PrototypeProcessingItem[]>>(async () => []),
  getRecordingStateApi: vi.fn(async () => ({ meetingId: null, startedAt: null, level: 0 }))
}))

vi.mock('@renderer/modules/widgets/recording/RecorderSection', () => ({
  default: () => <section aria-label="녹음 시작">Recorder</section>
}))
vi.mock('@renderer/shared/api/prototype', () => ({
  getProcessingApi,
  onPrototypeChanged: () => () => {}
}))
vi.mock('@renderer/shared/api/events', () => ({
  onRecordingState: () => () => {}
}))
vi.mock('@renderer/shared/api/recording', () => ({
  getRecordingStateApi
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  getProcessingApi.mockResolvedValue([])
  getRecordingStateApi.mockResolvedValue({ meetingId: null, startedAt: null, level: 0 })
})

describe('Record processing selection', () => {
  it('opens the recorder as the default Record tab', () => {
    render(
      <MemoryRouter initialEntries={['/record']}>
        <Record />
      </MemoryRouter>
    )

    expect(screen.getByRole('region', { name: '녹음 시작' })).toBeTruthy()
  })

  it('links back to recordings waiting for an A/B summary choice', async () => {
    getProcessingApi.mockResolvedValue([
      {
        meetingId: 'meeting-1',
        title: '제품 회의',
        stage: 'choosing',
        status: 'pending'
      }
    ] satisfies PrototypeProcessingItem[])
    render(
      <MemoryRouter initialEntries={['/record?new=1']}>
        <Routes>
          <Route path="/record" element={<Record />} />
          <Route path="/processing/:meetingId" element={<div>선택 화면</div>} />
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findByRole('region', { name: '선택 대기 중인 정리' })).toBeTruthy()
    expect(screen.getByRole('link', { name: '제품 회의' }).getAttribute('href')).toBe(
      '/processing/meeting-1'
    )
  })

  it('opens the waiting processing screen when returning to the Record tab after recording ends', async () => {
    getProcessingApi.mockResolvedValue([
      {
        meetingId: 'meeting-1',
        title: '제품 회의',
        stage: 'choosing',
        status: 'pending',
        completedStages: ['recording', 'transcribing', 'summarizing']
      }
    ] satisfies PrototypeProcessingItem[])
    render(
      <MemoryRouter initialEntries={['/record']}>
        <Routes>
          <Route path="/record" element={<Record />} />
          <Route path="/processing/:meetingId" element={<div>선택 화면</div>} />
        </Routes>
      </MemoryRouter>
    )

    expect(await screen.findByText('선택 화면')).toBeTruthy()
    expect(screen.queryByRole('region', { name: '녹음 시작' })).toBeNull()
  })

  it('lets an explicit new recording request bypass the waiting processing redirect', async () => {
    getProcessingApi.mockResolvedValue([
      {
        meetingId: 'meeting-1',
        title: '제품 회의',
        stage: 'choosing',
        status: 'pending'
      }
    ] satisfies PrototypeProcessingItem[])
    render(
      <MemoryRouter initialEntries={['/record?new=1']}>
        <Routes>
          <Route path="/record" element={<Record />} />
          <Route path="/processing/:meetingId" element={<div>선택 화면</div>} />
        </Routes>
      </MemoryRouter>
    )

    expect(screen.getByRole('region', { name: '녹음 시작' })).toBeTruthy()
    expect(await screen.findByRole('region', { name: '선택 대기 중인 정리' })).toBeTruthy()
  })
})
