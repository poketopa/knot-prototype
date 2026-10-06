// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { PrototypeProcessingItem } from '@shared/prototype'
import Record from './index'

const { getProcessingApi } = vi.hoisted(() => ({
  getProcessingApi: vi.fn<() => Promise<PrototypeProcessingItem[]>>(async () => [])
}))

vi.mock('@renderer/modules/widgets/recording/RecorderSection', () => ({
  default: () => <section aria-label="녹음 시작">Recorder</section>
}))
vi.mock('@renderer/shared/api/prototype', () => ({
  getProcessingApi,
  onPrototypeChanged: () => () => {}
}))

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
      <MemoryRouter initialEntries={['/record']}>
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
})
