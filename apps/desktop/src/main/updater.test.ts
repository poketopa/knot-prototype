import { beforeEach, describe, expect, it, vi } from 'vitest'

const checkForUpdatesMock = vi.fn()
const downloadUpdateMock = vi.fn()
const quitAndInstallMock = vi.fn()
const markMainWindowQuittingMock = vi.fn()
const installCalls: string[] = []
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
let classificationBusy = false

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
vi.mock('./prototype/classifyDocuments', () => ({
  isDocumentClassificationBusy: () => classificationBusy
}))
vi.mock('./windows/main', () => ({ markMainWindowQuitting: markMainWindowQuittingMock }))
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
    classificationBusy = false
    installCalls.length = 0
    markMainWindowQuittingMock.mockImplementation(() => installCalls.push('mark'))
    quitAndInstallMock.mockImplementation(() => installCalls.push('quit'))
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

  it('does not expose a release that is not newer than the running app', async () => {
    checkForUpdatesMock.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '0.3.0-preview.5' }
    })
    const { checkForUpdates } = await import('./updater')

    await expect(checkForUpdates()).resolves.toBeNull()

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
    expect(markMainWindowQuittingMock).not.toHaveBeenCalled()
    expect(quitAndInstallMock).not.toHaveBeenCalled()

    recordingBusy = false
    pipelineBusy = true
    expect(() => installUpdate()).toThrow('녹음이나 AI 처리가 끝난 뒤 설치해 주세요')
    expect(markMainWindowQuittingMock).not.toHaveBeenCalled()
    expect(quitAndInstallMock).not.toHaveBeenCalled()

    pipelineBusy = false
    classificationBusy = true
    expect(() => installUpdate()).toThrow('녹음이나 AI 처리가 끝난 뒤 설치해 주세요')
    expect(markMainWindowQuittingMock).not.toHaveBeenCalled()
    expect(quitAndInstallMock).not.toHaveBeenCalled()
  })

  it('marks the main window as quitting before native updater install', async () => {
    checkForUpdatesMock.mockResolvedValue({
      isUpdateAvailable: true,
      updateInfo: { version: '0.3.0-preview.6' }
    })
    downloadUpdateMock.mockResolvedValue(undefined)
    const { checkForUpdates, downloadUpdate, installUpdate } = await import('./updater')

    await checkForUpdates()
    await downloadUpdate()
    installUpdate()

    expect(markMainWindowQuittingMock).toHaveBeenCalledTimes(1)
    expect(quitAndInstallMock).toHaveBeenCalledTimes(1)
    expect(installCalls).toEqual(['mark', 'quit'])
  })

  it('does not install before a newer downloaded update is known', async () => {
    const { installUpdate } = await import('./updater')

    expect(() => installUpdate()).toThrow('설치할 새 버전이 없습니다')
    expect(markMainWindowQuittingMock).not.toHaveBeenCalled()
    expect(quitAndInstallMock).not.toHaveBeenCalled()
  })

  it('clears a downloaded update when a later check says this app is latest', async () => {
    checkForUpdatesMock
      .mockResolvedValueOnce({
        isUpdateAvailable: true,
        updateInfo: { version: '0.3.0-preview.6' }
      })
      .mockResolvedValueOnce({
        isUpdateAvailable: false,
        updateInfo: { version: '0.3.0-preview.5' }
      })
    downloadUpdateMock.mockResolvedValue(undefined)
    const { checkForUpdatesNow, downloadUpdate, installUpdate } = await import('./updater')

    await checkForUpdatesNow()
    await downloadUpdate()
    await expect(checkForUpdatesNow()).resolves.toEqual({
      currentVersion: '0.3.0-preview.5',
      availableVersion: null
    })

    expect(() => installUpdate()).toThrow('설치할 새 버전이 없습니다')
    expect(quitAndInstallMock).not.toHaveBeenCalled()
  })
})
