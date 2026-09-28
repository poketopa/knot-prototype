// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UpdateAvailableEvent } from '@shared/ipc'

vi.mock('@renderer/shared/api/update', () => ({
  downloadUpdateApi: vi.fn(),
  installUpdateApi: vi.fn()
}))
vi.mock('@renderer/shared/api/events', () => ({
  onUpdateAvailable: vi.fn(() => () => {})
}))

import { onUpdateAvailable } from '@renderer/shared/api/events'
import { downloadUpdateApi, installUpdateApi } from '@renderer/shared/api/update'
import UpdateBanner from './index'

const emitUpdateAvailable = async (event: UpdateAvailableEvent) => {
  const listener = vi.mocked(onUpdateAvailable).mock.calls.at(-1)?.[0]

  await act(async () => {
    listener?.(event)
  })
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('UpdateBanner', () => {
  it('새 버전 이벤트를 받기 전에는 아무것도 그리지 않는다', () => {
    render(<UpdateBanner />)

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('새 버전을 알리고 받기 → 다시 시작해 설치 순서로 진행한다', async () => {
    const user = userEvent.setup()
    vi.mocked(downloadUpdateApi).mockResolvedValue(undefined)
    vi.mocked(installUpdateApi).mockResolvedValue(undefined)
    render(<UpdateBanner />)

    await emitUpdateAvailable({ version: '0.2.0' })
    expect(screen.getByText(/새 버전 0.2.0이 있습니다/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '받기' }))
    expect(downloadUpdateApi).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/내려받기가 끝났습니다/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '다시 시작해 설치' }))
    expect(installUpdateApi).toHaveBeenCalledTimes(1)
  })

  it('내려받기에 실패하면 안내와 다시 시도를 보여준다', async () => {
    const user = userEvent.setup()
    vi.mocked(downloadUpdateApi).mockRejectedValue(new Error('새 버전을 내려받지 못했습니다'))
    render(<UpdateBanner />)

    await emitUpdateAvailable({ version: '0.2.0' })
    await user.click(screen.getByRole('button', { name: '받기' }))

    expect(screen.getByText('새 버전을 내려받지 못했습니다')).toBeTruthy()
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeTruthy()
  })
})
