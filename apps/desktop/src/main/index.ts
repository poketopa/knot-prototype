import { app, BrowserWindow, session } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import type {
  PipelineProgressEvent,
  RecordingStateEvent,
  SummaryProgressEvent,
  UpdateAvailableEvent
} from '@shared/ipc'
import { IPC } from '@shared/ipc'
import {
  finalizeActiveRecording,
  isRecordingBusy,
  isRecording,
  recordingsDir,
  setRecordingStateListener
} from './audio/session'
import { closeDb } from './db/connection'
import { recoverInterruptedRecordings } from './audio/recovery'
import { failStaleMeetings } from './db/meetings'
import { getAppSettings, getWhisperModelId } from './db/settings'
import { registerIpcHandlers } from './ipc/handlers'
import { error as logError, info, messageOf, warn } from './log'
import { setMeetingsChangedListener } from './meetingsChanged'
import { setSelectedWhisperModelId } from './models/paths'
import {
  isPipelineQueueBusy,
  recoverQueuedPrototypeJobs,
  setPipelineProgressListener,
  setSummaryProgressListener
} from './pipeline/queue'
import { removeStalePipelineArtifacts } from './pipeline/run'
import {
  flushPrototypeRevocations,
  handlePrototypeAuthCallback,
  setPrototypeAuthLifecycle
} from './prototype/auth'
import { loadPrototypeAuthSession, prototypeAuthState } from './prototype/authState'
import { drainPrototypeOutbox, isPrototypeOutboxRunning } from './prototype/outbox'
import { startPrototypeSyncWorker } from './prototype/sync'
import {
  recoverMissingArtifactOutbox,
  recoverTopicAttemptSpoolArtifacts
} from './prototype/artifacts'
import { prototypeUserDataPath } from './prototype/config'
import { trackPrototypeEvent } from './prototype/events'
import { checkForUpdates } from './updater'
import { createMainWindow, markMainWindowQuitting, showMainWindow } from './windows/main'
import { registerGlobalShortcuts, unregisterGlobalShortcuts } from './windows/shortcuts'
import { createTray, destroyTray, refreshTray } from './windows/tray'

/** 로컬 앱이라 마이크 외의 권한 요청은 받지 않는다 */
const restrictPermissions = () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media')
  })
}

const broadcast = ({ channel, event }: { channel: string; event: unknown }) => {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(channel, event)
  })
}

const broadcastProgress = (event: PipelineProgressEvent) =>
  broadcast({ channel: IPC.events.progress, event })

const broadcastSummaryProgress = (event: SummaryProgressEvent) =>
  broadcast({ channel: IPC.events.summary, event })

/** 녹음 상태는 메인 창·메뉴바가 같은 값을 봐야 한다 */
const broadcastRecordingState = (event: RecordingStateEvent) => {
  broadcast({ channel: IPC.events.recordingState, event })
  refreshTray()
}

let stopPrototypeSyncWorker: (() => void) | undefined
let isPrototypeLifecycleReady = false
const pendingOpenUrls: string[] = []

const handleOpenUrl = (url: string) => {
  if (!isPrototypeLifecycleReady) {
    pendingOpenUrls.push(url)
    return
  }

  handlePrototypeAuthCallback(url)
    .then(() => undefined)
    .catch((caught) => logError(`로그인 callback 처리 실패: ${messageOf(caught)}`))
}

const drainPendingOpenUrls = () => {
  const urls = pendingOpenUrls.splice(0)
  urls.forEach(handleOpenUrl)
}

/**
 * 설정에서 켠 사용자만, 창이 뜬 직후 한 번 확인한다. 새 버전이 있으면 알리기만 하고
 * 내려받기는 사용자가 배너에서 요청한다 (references/distribution.md 7절).
 */
const notifyUpdateIfAvailable = async () => {
  const version = await checkForUpdates({ isEnabled: getAppSettings().isUpdateCheckEnabled })
  if (!version) return

  const event: UpdateAvailableEvent = { version }
  broadcast({ channel: IPC.events.updateAvailable, event })
}

const resumePrototypeUserWork = async () => {
  setSelectedWhisperModelId(getWhisperModelId())
  await cleanupPreviousRun()
  setupPrototypeShell()
  recoverMissingArtifactOutbox()
  await recoverTopicAttemptSpoolArtifacts()
  recoverQueuedPrototypeJobs()
  void drainPrototypeOutbox()
  void flushPrototypeRevocations()
}

const setupPrototypeShell = () => {
  createTray()
  registerGlobalShortcuts()
}

/** 이전 실행이 녹음·처리 중에 죽은 흔적을 정리한다. 실패해도 앱은 뜬다 */
const cleanupPreviousRun = async () => {
  await recoverInterruptedRecordings()
  const cleaned = failStaleMeetings()
  if (cleaned) info(`비정상 종료로 남은 회의 ${cleaned}건을 오류로 정리했습니다`)

  try {
    const removed = await removeStalePipelineArtifacts({ dir: recordingsDir() })
    if (removed) info(`남은 파이프라인 임시 파일 ${removed}개를 지웠습니다`)
  } catch (caught) {
    warn(`파이프라인 임시 파일 정리 실패: ${messageOf(caught)}`)
  }
}

// 두 인스턴스가 같은 DB를 열면 나중에 뜬 쪽의 시작 정리가 처리 중 회의를 오류로 덮어쓴다 (references/distribution.md 9절)
app.setName('Knot Meeting Prototype')
app.setPath('userData', prototypeUserDataPath({ appDataPath: app.getPath('appData') }))
const isPrimaryInstance = app.requestSingleInstanceLock()
if (!isPrimaryInstance) app.quit()

app.on('second-instance', () => showMainWindow())

app.on('open-url', (event, url) => {
  event.preventDefault()
  handleOpenUrl(url)
})

app.whenReady().then(async () => {
  // quit()은 비동기라 ready가 먼저 올 수 있다. 두 번째 인스턴스는 DB를 열지 않는다
  if (!isPrimaryInstance) return

  electronApp.setAppUserModelId('com.knot.meetingstt.prototype')
  // macOS custom schemes require the packaged Info.plist; dev Electron must not replace its handler.
  if (app.isPackaged && !app.setAsDefaultProtocolClient('knot-prototype'))
    warn('로그인 callback 프로토콜을 등록하지 못했습니다')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  restrictPermissions()
  await loadPrototypeAuthSession()
  setPrototypeAuthLifecycle({
    isBusy: () => isRecordingBusy() || isPipelineQueueBusy() || isPrototypeOutboxRunning(),
    beforeSwitch: () => {
      unregisterGlobalShortcuts()
      destroyTray()
      closeDb()
    },
    afterSwitch: async () => {
      await resumePrototypeUserWork()
      trackPrototypeEvent({ eventType: 'login_succeeded' })
    }
  })
  stopPrototypeSyncWorker = startPrototypeSyncWorker()
  isPrototypeLifecycleReady = true
  drainPendingOpenUrls()
  registerIpcHandlers()
  setPipelineProgressListener(broadcastProgress)
  setSummaryProgressListener(broadcastSummaryProgress)
  setRecordingStateListener(broadcastRecordingState)
  setMeetingsChangedListener(() => broadcast({ channel: IPC.events.meetingsChanged, event: null }))
  void flushPrototypeRevocations()
  const mainWindow = createMainWindow()
  if (prototypeAuthState().isAuthenticated) {
    await resumePrototypeUserWork()
  }

  mainWindow.once('ready-to-show', () => {
    if (prototypeAuthState().isAuthenticated) void notifyUpdateIfAvailable()
  })

  app.on('activate', () => showMainWindow())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/**
 * 화면 이동으로 녹음이 정지되지 않게 되면서(Phase 5-3) 헤더 확정의 마지막 기회가 종료 시점이다.
 * 헤더가 확정되지 않은 WAV는 파이프라인이 읽지 못한다.
 */
let isFinalizingOnQuit = false

app.on('before-quit', (event) => {
  markMainWindowQuitting()

  if (isFinalizingOnQuit || !isRecording()) return

  event.preventDefault()
  isFinalizingOnQuit = true
  finalizeActiveRecording()
    .then(() => info('종료 전에 진행 중이던 녹음을 저장했습니다'))
    .catch((caught) => logError(`종료 중 녹음 마무리 실패: ${messageOf(caught)}`))
    .finally(() => app.quit())
})

app.on('will-quit', () => {
  stopPrototypeSyncWorker?.()
  unregisterGlobalShortcuts()
  destroyTray()
  closeDb()
})
