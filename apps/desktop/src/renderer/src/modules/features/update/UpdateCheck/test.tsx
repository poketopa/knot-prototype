// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@renderer/shared/api/update', () => ({
  checkUpdateApi: vi.fn(),
  downloadUpdateApi: vi.fn(),
  installUpdateApi: vi.fn()
}))
vi.mock('@renderer/shared/api/events', () => ({
  onUpdateAvailable: vi.fn(() => () => {})
}))

import { checkUpdateApi, downloadUpdateApi, installUpdateApi } from '@renderer/shared/api/update'
import UpdateCheck from './index'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('UpdateCheck', () => {
  it('새 버전이 없으면 지금 버전이 최신이라고 알린다', async () => {
    const user = userEvent.setup()
    vi.mocked(checkUpdateApi).mockResolvedValue({ currentVersion: '0.1.1', availableVersion: null })
    render(<UpdateCheck />)

    await user.click(screen.getByRole('button', { name: '지금 확인' }))

    expect(checkUpdateApi).toHaveBeenCalledTimes(1)
    expect(screen.getByText('최신 버전(0.1.1)을 쓰고 있습니다')).toBeTruthy()
  })

  it('새 버전을 찾으면 받기 → 다시 시작해 설치로 이어진다', async () => {
    const user = userEvent.setup()
    vi.mocked(checkUpdateApi).mockResolvedValue({
      currentVersion: '0.1.1',
      availableVersion: '0.1.2'
    })
    vi.mocked(downloadUpdateApi).mockResolvedValue(undefined)
    vi.mocked(installUpdateApi).mockResolvedValue(undefined)
    render(<UpdateCheck />)

    await user.click(screen.getByRole('button', { name: '지금 확인' }))
    expect(screen.getByText('새 버전 0.1.2이 있습니다')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '받기' }))
    expect(downloadUpdateApi).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '다시 시작해 설치' }))
    expect(installUpdateApi).toHaveBeenCalledTimes(1)
  })

  it('확인에 실패하면 안내를 보여주고 다시 확인할 수 있다', async () => {
    const user = userEvent.setup()
    vi.mocked(checkUpdateApi).mockRejectedValue(
      new Error('업데이트를 확인하지 못했습니다. 네트워크 연결을 확인해 주세요')
    )
    render(<UpdateCheck />)

    await user.click(screen.getByRole('button', { name: '지금 확인' }))

    expect(screen.getByText(/네트워크 연결을 확인해 주세요/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '지금 확인' })).toBeTruthy()
  })
})
