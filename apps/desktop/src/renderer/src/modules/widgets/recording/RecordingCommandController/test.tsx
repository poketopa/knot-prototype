// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import type { RecordingCommandEvent } from '@shared/ipc'

vi.mock('@renderer/shared/api/recording', () => ({
  requestMicrophonePermissionApi: vi.fn(),
  startRecordingApi: vi.fn(),
  sendRecordingChunkApi: vi.fn(),
  stopRecordingApi: vi.fn(),
  reportRecordingErrorApi: vi.fn()
}))

vi.mock('@renderer/shared/api/events', () => ({
  onRecordingCommand: vi.fn(),
  onModelDownloadProgress: vi.fn(() => () => {})
}))

vi.mock('@renderer/shared/api/models', () => ({
  getModelStatusApi: vi.fn()
}))

import { onRecordingCommand } from '@renderer/shared/api/events'
import { getModelStatusApi } from '@renderer/shared/api/models'
import { requestMicrophonePermissionApi, startRecordingApi } from '@renderer/shared/api/recording'
import RecordingCommandController from './index'

const READY_MODEL_STATUS = {
  isReady: true,
  isSummaryReady: false,
  selectedWhisperModelId: 'turbo-q5' as const,
  recommendedWhisperModelId: 'turbo-q5' as const,
  whisperOptions: [],
  items: []
}

let pushCommand: (event: RecordingCommandEvent) => void = () => {}
let closeAudioContextCalls = 0

const stubAudioGraph = ({
  getUserMedia = () => Promise.resolve({ getTracks: () => [] })
}: {
  getUserMedia?: () => Promise<{ getTracks: () => Array<{ stop?: () => void }> }>
} = {}) => {
  class FakeAudioWorkletNode {
    port: { onmessage: ((event: MessageEvent<ArrayBuffer>) => void) | null } = { onmessage: null }
    connect = <T,>(node: T) => node
    disconnect = () => {}
  }

  class FakeAudioContext {
    sampleRate = 16000
    destination = {}
    audioWorklet = { addModule: () => Promise.resolve() }
    createGain = () => ({ gain: { value: 1 }, connect: <T,>(node: T) => node })
    createMediaStreamSource = () => ({ connect: <T,>(node: T) => node })
    close = () => {
      closeAudioContextCalls += 1

      return Promise.resolve()
    }
  }

  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode)
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia }
  })
}

beforeEach(async () => {
  closeAudioContextCalls = 0
  stubAudioGraph()
  vi.mocked(onRecordingCommand).mockImplementation((listener) => {
    pushCommand = listener

    return () => {}
  })
  vi.mocked(getModelStatusApi).mockResolvedValue(READY_MODEL_STATUS)
  vi.mocked(requestMicrophonePermissionApi).mockResolvedValue(true)
  vi.mocked(startRecordingApi).mockResolvedValue('meeting-1')
  const { reportRecordingErrorApi } = await import('@renderer/shared/api/recording')
  vi.mocked(reportRecordingErrorApi).mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('RecordingCommandController', () => {
  it('시작 명령이 겹쳐도 녹음 세션을 하나만 만든다', async () => {
    render(<RecordingCommandController />)
    await waitFor(() => expect(onRecordingCommand).toHaveBeenCalled())

    await act(async () => {
      pushCommand({ kind: 'start' })
      pushCommand({ kind: 'start' })
    })

    await waitFor(() => expect(startRecordingApi).toHaveBeenCalledTimes(1))
  })

  it('StrictMode effect remount 이후에도 녹음 명령을 처리한다', async () => {
    render(
      <StrictMode>
        <RecordingCommandController />
      </StrictMode>
    )
    await waitFor(() => expect(onRecordingCommand).toHaveBeenCalled())

    await act(async () => {
      pushCommand({ kind: 'start' })
    })

    await waitFor(() => expect(startRecordingApi).toHaveBeenCalledTimes(1))
  })

  it('시작 도중 언마운트되면 오디오 그래프를 닫고 세션을 만들지 않는다', async () => {
    let grantMicrophone: (stream: { getTracks: () => [] }) => void = () => {}
    stubAudioGraph({
      getUserMedia: () =>
        new Promise((resolve) => {
          grantMicrophone = resolve
        })
    })
    const { unmount } = render(<RecordingCommandController />)
    await waitFor(() => expect(onRecordingCommand).toHaveBeenCalled())

    await act(async () => {
      pushCommand({ kind: 'start' })
    })
    unmount()
    await act(async () => {
      grantMicrophone({ getTracks: () => [] })
    })

    await waitFor(() => expect(closeAudioContextCalls).toBe(1))
    expect(startRecordingApi).not.toHaveBeenCalled()
  })
})
