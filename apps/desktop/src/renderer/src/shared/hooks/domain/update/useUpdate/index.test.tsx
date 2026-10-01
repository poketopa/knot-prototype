// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/shared/api/update', () => ({
  checkUpdateApi: vi.fn(),
  downloadUpdateApi: vi.fn(),
  installUpdateApi: vi.fn()
}))
vi.mock('@renderer/shared/api/events', () => ({
  onUpdateAvailable: vi.fn(() => () => {})
}))

import { checkUpdateApi, downloadUpdateApi } from '@renderer/shared/api/update'
import useUpdate from './index'

afterEach(() => {
  vi.clearAllMocks()
})

describe('useUpdate', () => {
  it('clears a downloaded update when the next check says the app is latest', async () => {
    vi.mocked(checkUpdateApi)
      .mockResolvedValueOnce({
        currentVersion: '0.3.0-preview.5',
        availableVersion: '0.3.0-preview.6'
      })
      .mockResolvedValueOnce({ currentVersion: '0.3.0-preview.6', availableVersion: null })
    vi.mocked(downloadUpdateApi).mockResolvedValue(undefined)
    const { result } = renderHook(() => useUpdate())

    await act(async () => {
      await result.current.check()
    })
    await act(async () => {
      await result.current.download()
    })
    expect(result.current.stage).toBe('downloaded')
    expect(result.current.version).toBe('0.3.0-preview.6')

    await act(async () => {
      await result.current.check()
    })

    expect(result.current.stage).toBe('latest')
    expect(result.current.currentVersion).toBe('0.3.0-preview.6')
    expect(result.current.version).toBeNull()
  })
})
