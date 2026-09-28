// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@renderer/shared/api/settings', () => ({
  getSettingsApi: vi.fn(),
  updateSettingsApi: vi.fn(),
  setShortcutsSuspendedApi: vi.fn().mockResolvedValue(undefined)
}))

import {
  getSettingsApi,
  setShortcutsSuspendedApi,
  updateSettingsApi
} from '@renderer/shared/api/settings'
import SettingsSection from './index'

const RECORDING_SHORTCUT_BUTTON = '녹음 시작·정지 변경'

const DEFAULT_SETTINGS = {
  isAudioKept: true,
  isUpdateCheckEnabled: false,
  recordingShortcut: 'Alt+Command+R'
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SettingsSection', () => {
  it('영구 보관을 안내하고 위젯·조용히 처리 설정을 노출하지 않는다', async () => {
    vi.mocked(getSettingsApi).mockResolvedValue(DEFAULT_SETTINGS)
    render(<SettingsSection />)

    expect(await screen.findByText(/보관 기간 제한 없이 저장합니다/)).toBeTruthy()
    expect(screen.queryByRole('switch', { name: '조용히 처리' })).toBeNull()
    expect(screen.queryByText(/녹음 위젯/)).toBeNull()
    expect(screen.queryByRole('button', { name: /위젯 표시/ })).toBeNull()
  })

  it('단축키를 입력받는 동안 전역 단축키를 풀고, 누른 조합을 저장한다', async () => {
    const user = userEvent.setup()
    vi.mocked(getSettingsApi).mockResolvedValue(DEFAULT_SETTINGS)
    vi.mocked(updateSettingsApi).mockResolvedValue({
      ...DEFAULT_SETTINGS,
      recordingShortcut: 'Control+Shift+F5'
    })
    render(<SettingsSection />)

    const button = await screen.findByRole('button', { name: RECORDING_SHORTCUT_BUTTON })
    expect(button.textContent).toBe('⌥⌘R')

    await user.click(button)
    expect(setShortcutsSuspendedApi).toHaveBeenLastCalledWith({ isSuspended: true })

    fireEvent.keyDown(button, { code: 'F5', key: 'F5', ctrlKey: true, shiftKey: true })

    expect(updateSettingsApi).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      recordingShortcut: 'Control+Shift+F5'
    })
    expect(await screen.findByText('⌃⇧F5')).toBeTruthy()
    expect(setShortcutsSuspendedApi).toHaveBeenLastCalledWith({ isSuspended: false })
  })

  it('설정을 못 불러와도 children은 보여준다', async () => {
    vi.mocked(getSettingsApi).mockRejectedValue(new Error('실패'))
    render(
      <SettingsSection>
        <p>모델 영역</p>
      </SettingsSection>
    )

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('모델 영역')).toBeTruthy()
  })
})
