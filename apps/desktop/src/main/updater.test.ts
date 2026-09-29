import { beforeEach, describe, expect, it, vi } from 'vitest'

const checkForUpdatesMock = vi.fn()
const downloadUpdateMock = vi.fn()
const quitAndInstallMock = vi.fn()
const autoUpdater = {
  autoDownload: true,
  autoInstallOnAppQuit: true,
  allowPrerelease: false,
  checkForUpdates: checkForUpdatesMock,
  downloadUpdate: downloadUpdateMock,
  quitAndInstall: quitAndInstallMock
}
let isDev = false
let recordingBusy = false
let pipelineBusy = false

vi.mock('electron-updater', () => ({ autoUpdater }))
vi.mock('@electron-toolkit/utils', () => ({
  is: {
    get dev() {
      return isDev
    }
  }
}))
vi.mock('electron', () => ({ app: { getVersion: () => '0.3.0-preview.5' } }))
vi.mock('./audio/session', () => ({ isRecordingBusy: () => recordingBusy }))
vi.mock('./pipeline/queue', () => ({ isPipelineQueueBusy: () => pipelineBusy }))
vi.mock('./log', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  messageOf: (caught: unknown) => String(caught)
}))

describe('updater', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    isDev = false
    recordingBusy = false
    pipelineBusy = false
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false
  })

  it('checks GitHub prerelease updates without downloading at startup', async () => {
    checkForUpdatesMock.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '0.3.0-preview.6' }
    })
    const { checkForUpdates } = await import('./updater')

    await expect(checkForUpdates()).resolves.toBe('0.3.0-preview.6')

    expect(autoUpdater.autoDownload).toBe(false)
    expect(autoUpdater.autoInstallOnAppQuit).toBe(false)
    expect(autoUpdater.allowPrerelease).toBe(true)
    expect(downloadUpdateMock).not.toHaveBeenCalled()
  })

  it('does not check for updates in dev mode', async () => {
    isDev = true
    const { checkForUpdates } = await import('./updater')

    await expect(checkForUpdates()).resolves.toBeNull()

    expect(checkForUpdatesMock).not.toHaveBeenCalled()
  })

  it('blocks installing while recording or AI processing is busy', async () => {
    recordingBusy = true
    const { installUpdate } = await import('./updater')

    expect(() => installUpdate()).toThrow('녹음이나 AI 처리가 끝난 뒤 설치해 주세요')
    expect(quitAndInstallMock).not.toHaveBeenCalled()

    recordingBusy = false
    pipelineBusy = true
    expect(() => installUpdate()).toThrow('녹음이나 AI 처리가 끝난 뒤 설치해 주세요')
    expect(quitAndInstallMock).not.toHaveBeenCalled()
  })

  it('installs when no local work is running', async () => {
    const { installUpdate } = await import('./updater')

    installUpdate()

    expect(quitAndInstallMock).toHaveBeenCalledTimes(1)
  })
})
