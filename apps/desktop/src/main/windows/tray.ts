import { join } from 'node:path'
import { app, Menu, nativeImage, Tray } from 'electron'
import { is } from '@electron-toolkit/utils'
import { getRecordingState } from '../audio/session'
import { messageOf, warn } from '../log'
import { requestRecordingCommand, showMainWindow } from './main'

/** 파일명이 Template으로 끝나야 macOS가 다크/라이트에 맞춰 반전한다 (references/pitfalls.md) */
const TRAY_ICON_FILE = 'trayTemplate.png'
const TITLE_TICK_MS = 1000
const MS_PER_SEC = 1000
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60

let tray: Tray | null = null
/** 메뉴는 녹음 상태가 바뀔 때만 다시 만든다. 레벨 갱신마다 바꾸면 초당 두 번 교체된다 */
let menuRecordingState: boolean | null = null
/** 상시 1초 타이머는 유휴 상태에서도 CPU를 깨운다 → 녹음 중에만 돌린다 */
let titleTimer: NodeJS.Timeout | null = null

const trayIconPath = () =>
  is.dev
    ? join(app.getAppPath(), 'resources', TRAY_ICON_FILE)
    : join(process.resourcesPath, 'app.asar.unpacked', 'resources', TRAY_ICON_FILE)

const pad2 = (value: number) => String(value).padStart(2, '0')

/** 메뉴바는 폭이 좁아 한 시간 미만이면 m:ss로 짧게 쓴다 */
const formatElapsed = (elapsedMs: number) => {
  const total = Math.max(0, Math.floor(elapsedMs / MS_PER_SEC))
  const minutes = Math.floor(total / SECONDS_PER_MINUTE)
  const seconds = total % SECONDS_PER_MINUTE

  if (minutes < MINUTES_PER_HOUR) return `${minutes}:${pad2(seconds)}`

  return `${Math.floor(minutes / MINUTES_PER_HOUR)}:${pad2(minutes % MINUTES_PER_HOUR)}:${pad2(seconds)}`
}

const buildMenu = ({ isRecording }: { isRecording: boolean }) =>
  Menu.buildFromTemplate([
    {
      label: isRecording ? '녹음 정지' : '녹음 시작',
      click: () => requestRecordingCommand({ kind: isRecording ? 'stop' : 'start' })
    },
    { label: '메인 창 열기', click: () => showMainWindow() },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() }
  ])

const setTitle = (title: string) => {
  // setTitle은 macOS 전용이다. 다른 플랫폼에서는 아이콘만 남는다
  if (process.platform === 'darwin') tray?.setTitle(title)
}

const stopTitleTimer = () => {
  if (!titleTimer) return

  clearInterval(titleTimer)
  titleTimer = null
}

/** 녹음 상태가 바뀔 때마다 메뉴 문구와 시간 표시를 맞춘다 */
export const refreshTray = () => {
  if (!tray) return

  const { startedAt } = getRecordingState()
  const isRecording = startedAt !== null

  if (menuRecordingState !== isRecording) {
    menuRecordingState = isRecording
    tray.setContextMenu(buildMenu({ isRecording }))
  }

  if (startedAt === null) {
    stopTitleTimer()
    setTitle('')

    return
  }

  setTitle(`● ${formatElapsed(Date.now() - startedAt)}`)
  if (titleTimer) return

  titleTimer = setInterval(
    () => setTitle(`● ${formatElapsed(Date.now() - startedAt)}`),
    TITLE_TICK_MS
  )
}

/** 아이콘을 읽지 못해도 앱은 뜬다 — 트레이가 없으면 패널과 단축키로 모든 동작을 할 수 있다 */
export const createTray = () => {
  if (tray) return

  try {
    const icon = nativeImage.createFromPath(trayIconPath())
    if (icon.isEmpty()) throw new Error(`아이콘을 읽지 못했습니다 (${trayIconPath()})`)

    icon.setTemplateImage(true)
    tray = new Tray(icon)
    tray.setToolTip('meeting-stt')
    refreshTray()
  } catch (caught) {
    warn(`메뉴바 아이콘을 만들지 못했습니다: ${messageOf(caught)}`)
  }
}

export const destroyTray = () => {
  stopTitleTimer()
  tray?.destroy()
  tray = null
}
