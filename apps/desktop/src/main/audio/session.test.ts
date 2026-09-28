import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { SAMPLE_RATE_HZ } from '@shared/audio'

let userDataDir: string
let finishWriterOpen: (() => void) | null = null
let failWriterOpen: ((error: Error) => void) | null = null

vi.mock('../prototype/authState', () => ({
  prototypeUserRoot: () => path.join(userDataDir, 'prototype', 'users', 'owner-1')
}))

vi.mock('../db/meetings', () => ({
  findMeeting: vi.fn(),
  insertMeeting: vi.fn(),
  updateMeetingDuration: vi.fn(),
  updateMeetingSpeakerCount: vi.fn(),
  updateMeetingStatus: vi.fn()
}))

vi.mock('../log', () => ({ info: vi.fn(), warn: vi.fn() }))
vi.mock('../meetingsChanged', () => ({ notifyMeetingsChanged: vi.fn() }))
vi.mock('../pipeline/queue', () => ({ enqueuePipelineJob: vi.fn() }))
vi.mock('../prototype/artifacts', () => ({ preserveAudioArtifact: vi.fn() }))
vi.mock('../prototype/events', () => ({ trackPrototypeEvent: vi.fn() }))
vi.mock('../prototype/jobs', () => ({ upsertPrototypeJob: vi.fn() }))
vi.mock('../prototype/outbox', () => ({ enqueueOutbox: vi.fn() }))
vi.mock('./wavWriter', () => ({
  createWavWriter: vi.fn(
    () =>
      new Promise((resolve, reject) => {
        finishWriterOpen = () =>
          resolve({
            appendChunk: vi.fn(),
            finalize: vi.fn().mockResolvedValue({ durationSec: 2 })
          })
        failWriterOpen = reject
      })
  )
}))

describe('recording session', () => {
  beforeEach(async () => {
    vi.resetModules()
    userDataDir = await mkdtemp(path.join(os.tmpdir(), 'meeting-stt-session-'))
    finishWriterOpen = null
    failWriterOpen = null
  })

  afterEach(async () => {
    await rm(userDataDir, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('녹음 파일을 여는 중에도 중복 시작을 거절한다', async () => {
    const { isRecordingBusy, startRecording } = await import('./session')
    expect(isRecordingBusy()).toBe(false)
    const first = startRecording({ sampleRate: SAMPLE_RATE_HZ })
    await vi.waitFor(() => expect(finishWriterOpen).toBeTypeOf('function'))
    expect(isRecordingBusy()).toBe(true)

    await expect(startRecording({ sampleRate: SAMPLE_RATE_HZ })).rejects.toThrow(
      '이미 녹음이 진행 중입니다'
    )

    finishWriterOpen?.()
    await expect(first).resolves.toEqual({ meetingId: expect.any(String) })
    expect(isRecordingBusy()).toBe(true)
  })

  it('녹음 파일 열기에 실패하면 busy 상태를 해제한다', async () => {
    const { isRecordingBusy, startRecording } = await import('./session')
    const started = startRecording({ sampleRate: SAMPLE_RATE_HZ })
    await vi.waitFor(() => expect(failWriterOpen).toBeTypeOf('function'))

    expect(isRecordingBusy()).toBe(true)
    failWriterOpen?.(new Error('writer failed'))

    await expect(started).rejects.toThrow('writer failed')
    expect(isRecordingBusy()).toBe(false)
  })
})
