import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/ipc'

const windowState = vi.hoisted(() => ({
  listeners: new Map<string, (event: { preventDefault: () => void }) => void>(),
  hide: vi.fn(),
  show: vi.fn(),
  focus: vi.fn(),
  send: vi.fn(),
  create: vi.fn(),
  getSetupStatus: vi.fn()
}))
vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
  BrowserWindow: class {
    constructor(options: unknown) {
      windowState.create(options)
    }
    on = (name: string, listener: (event: { preventDefault: () => void }) => void) => {
      windowState.listeners.set(name, listener)
    }
    hide = windowState.hide
    show = windowState.show
    focus = windowState.focus
    isDestroyed = () => false
    isMinimized = () => false
    loadFile = vi.fn()
    loadURL = vi.fn()
    webContents = {
      setWindowOpenHandler: vi.fn(),
      isLoading: () => false,
      send: windowState.send
    }
  }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('../prototype/setup', () => ({ getSetupStatus: windowState.getSetupStatus }))

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  windowState.listeners.clear()
  windowState.getSetupStatus.mockReturnValue({ isComplete: true })
})

describe('녹음을 소유한 메인 창', () => {
  it('창 닫기는 renderer를 없애지 않고 숨기며 백그라운드 실행을 유지한다', async () => {
    const { createMainWindow } = await import('./main')
    createMainWindow()
    const event = { preventDefault: vi.fn() }
    windowState.listeners.get('close')!(event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(windowState.hide).toHaveBeenCalledOnce()
    expect(windowState.create).toHaveBeenCalledWith(
      expect.objectContaining({
        webPreferences: expect.objectContaining({ backgroundThrottling: false })
      })
    )
  })
  it('앱 종료 시에는 창 닫기를 막지 않는다', async () => {
    const { createMainWindow, markMainWindowQuitting } = await import('./main')
    createMainWindow()
    markMainWindowQuitting()
    const event = { preventDefault: vi.fn() }
    windowState.listeners.get('close')!(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(windowState.hide).not.toHaveBeenCalled()
  })
  it('설정을 마친 녹음 명령은 같은 메인 창으로 보낸다', async () => {
    const { createMainWindow, requestRecordingCommand } = await import('./main')
    createMainWindow()
    requestRecordingCommand({ kind: 'start' })
    expect(windowState.create).toHaveBeenCalledOnce()
    expect(windowState.send).toHaveBeenCalledWith(IPC.events.recordingCommand, { kind: 'start' })
  })
  it('설정 전 녹음 단축키는 설정 화면을 보여준다', async () => {
    windowState.getSetupStatus.mockReturnValue({ isComplete: false })
    const { createMainWindow, requestRecordingCommand } = await import('./main')
    createMainWindow()
    requestRecordingCommand({ kind: 'toggle' })
    expect(windowState.send).not.toHaveBeenCalled()
    expect(windowState.show).toHaveBeenCalledOnce()
    expect(windowState.focus).toHaveBeenCalledOnce()
  })
})
