import { join } from 'node:path'
import { BrowserWindow, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { IPC, type RecordingCommandEvent } from '@shared/ipc'
import icon from '../../../resources/icon.png?asset'
import { getSetupStatus } from '../prototype/setup'

/** 사이드바 272px + 본문 두 칸이 최소 폭에서도 회의록 줄 길이를 지키는 크기 (references/architecture.md) */
const WINDOW_WIDTH = 1280
const WINDOW_HEIGHT = 800
const WINDOW_MIN_WIDTH = 1040
const WINDOW_MIN_HEIGHT = 640
/** 신호등을 사이드바 상단 52px 바의 세로 가운데에 둔다 */
const TRAFFIC_LIGHT_POSITION = { x: 18, y: 18 }

let mainWindow: BrowserWindow | null = null
let isAppQuitting = false

export const getMainWindow = () => (mainWindow?.isDestroyed() ? null : mainWindow)

export const markMainWindowQuitting = () => {
  isAppQuitting = true
}

export const createMainWindow = () => {
  const window = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: TRAFFIC_LIGHT_POSITION,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false
    }
  })

  window.on('ready-to-show', () => {
    window.show()
  })

  window.on('close', (event) => {
    if (isAppQuitting) return

    event.preventDefault()
    window.hide()
  })

  window.on('closed', () => {
    mainWindow = null
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)

    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow = window

  return window
}

/** 트레이·단축키에서 메인 창을 앞으로 가져올 때 쓴다. 닫혀 있으면 다시 만든다 */
export const showMainWindow = () => {
  const window = getMainWindow() ?? createMainWindow()

  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()

  return window
}

export const requestRecordingCommand = (event: RecordingCommandEvent) => {
  const window = getMainWindow() ?? createMainWindow()
  try {
    if (getSetupStatus().isComplete) {
      const send = () => window.webContents.send(IPC.events.recordingCommand, event)
      if (window.webContents.isLoading()) window.webContents.once('did-finish-load', send)
      else send()

      return
    }
  } catch {
    // 로그인 전에는 설정을 읽을 수 없다. 창을 앞으로 가져와 로그인 화면을 보여준다.
  }

  showMainWindow()
}
