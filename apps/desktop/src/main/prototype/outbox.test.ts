import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ root: '', paused: false, authenticated: true, request: vi.fn() }))
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('./authState', () => ({
  requirePrototypeUser: () => ({ id: 'owner-a' }),
  prototypeUserRoot: () => state.root,
  prototypeAuthState: () => ({ isAuthenticated: state.authenticated, isSyncPaused: state.paused }),
  isPrototypeAuthTransitioning: () => false
}))
vi.mock('./auth', () => ({ flushPrototypeRevocations: vi.fn() }))
vi.mock('./apiClient', () => ({
  prototypeRequest: state.request,
  prototypeUpload: vi.fn(),
  PrototypeApiError: class extends Error {
    status: number
    retryable: boolean
    constructor(p: { status: number; retryable: boolean }) {
      super('fixture error')
      this.status = p.status
      this.retryable = p.retryable
    }
  }
}))
import { getDb, closeDb } from '../db/connection'
import { enqueueOutbox, drainPrototypeOutbox } from './outbox'
import { startPrototypeSyncWorker } from './sync'
import { PrototypeApiError } from './apiClient'
let stop: (() => void) | undefined
beforeEach(async () => {
  state.root = await mkdtemp(path.join(os.tmpdir(), 'knot-outbox-test-'))
  state.paused = false
  state.authenticated = true
  state.request.mockReset()
  state.request.mockResolvedValue({})
  vi.useFakeTimers()
})
afterEach(async () => {
  stop?.()
  stop = undefined
  vi.useRealTimers()
  closeDb()
  await rm(state.root, { recursive: true, force: true })
})
const queueEvent = () =>
  enqueueOutbox({
    kind: 'events',
    payload: { eventId: 'event-a', eventType: 'copied', occurredAt: '2026-09-28T00:00:00Z' }
  })
it('20개를 넘는 대기 항목과 로그인 후 생긴 항목을 주기적으로 전송한다', async () => {
  for (let i = 0; i < 25; i++) queueEvent()
  stop = startPrototypeSyncWorker()
  await vi.advanceTimersByTimeAsync(2100)
  expect(state.request).toHaveBeenCalledTimes(25)
  queueEvent()
  await vi.advanceTimersByTimeAsync(1000)
  expect(state.request).toHaveBeenCalledTimes(26)
  expect(
    getDb().prepare("SELECT count(*) AS n FROM prototype_outbox WHERE status!='succeeded'").get()
  ).toEqual({ n: 0 })
})
it('네트워크 실패는 예정 시각에 재시도하고 401은 다시 로그인할 때까지 멈춘다', async () => {
  queueEvent()
  state.request.mockRejectedValueOnce(new Error('offline'))
  stop = startPrototypeSyncWorker()
  await vi.advanceTimersByTimeAsync(3100)
  expect(state.request).toHaveBeenCalledTimes(2)
  queueEvent()
  queueEvent()
  state.request.mockImplementationOnce(async () => {
    state.paused = true
    throw new PrototypeApiError({
      code: 'SESSION_INVALID',
      message: 'expired',
      status: 401,
      retryable: false
    })
  })
  await vi.advanceTimersByTimeAsync(6000)
  expect(state.request).toHaveBeenCalledTimes(3)
  expect(
    getDb().prepare("SELECT count(*) AS n FROM prototype_outbox WHERE status='pending'").get()
  ).toEqual({ n: 2 })
  state.paused = false
  await vi.advanceTimersByTimeAsync(1000)
  expect(state.request).toHaveBeenCalledTimes(5)
})
it('녹음 시작 이벤트보다 녹음 메타데이터를 먼저 전송한다', async () => {
  queueEvent()
  enqueueOutbox({ kind: 'recording', payload: { id: 'recording-a', title: '회의' } })
  await drainPrototypeOutbox()
  expect(state.request.mock.calls[0][0].path).toBe('/recordings/recording-a')
})
it('서버 이벤트 단계 계약으로 변환하고 임의 metadata를 전송하지 않는다', async () => {
  enqueueOutbox({
    kind: 'events',
    payload: {
      eventId: 'e',
      eventType: 'processing_stage_succeeded',
      stage: 'summarizing',
      metadata: { transcript: 'secret' }
    }
  })
  await drainPrototypeOutbox()
  const body = state.request.mock.calls[0][0].body
  expect(body.events[0].metadata).toEqual({ stage: 'ai_analysis' })
  expect(JSON.stringify(body)).not.toContain('secret')
})

const queueRecordingEvent = (recordingId = 'recording-a') =>
  enqueueOutbox({
    kind: 'events',
    payload: {
      eventId: `start-${recordingId}`,
      eventType: 'recording_started',
      recordingId,
      occurredAt: '2026-09-28T00:00:00Z'
    }
  })

it('녹음 중 시작 이벤트는 기다렸다가 녹음 정보 저장 확인 후 원래 시각으로 전송한다', async () => {
  const eventId = queueRecordingEvent()
  await drainPrototypeOutbox()
  expect(state.request).not.toHaveBeenCalled()
  expect(
    getDb().prepare('SELECT status,attempt_count FROM prototype_outbox WHERE id=?').get(eventId)
  ).toEqual({ status: 'pending', attempt_count: 0 })

  enqueueOutbox({ kind: 'recording', payload: { id: 'recording-a' } })
  await drainPrototypeOutbox()
  await drainPrototypeOutbox()
  expect(state.request.mock.calls.map(([request]) => request.path)).toEqual([
    '/recordings/recording-a',
    '/events/batch'
  ])
  expect(state.request.mock.calls[1][0].body.events[0]).toMatchObject({
    eventId: 'start-recording-a',
    occurredAt: '2026-09-28T00:00:00Z'
  })
  await drainPrototypeOutbox()
  expect(state.request).toHaveBeenCalledTimes(2)
})

it('녹음 정보 업로드가 실패해도 시작 이벤트를 먼저 보내거나 영구 실패시키지 않는다', async () => {
  queueRecordingEvent()
  enqueueOutbox({ kind: 'recording', payload: { id: 'recording-a' } })
  state.request.mockRejectedValueOnce(new Error('offline'))
  await drainPrototypeOutbox()
  expect(state.request).toHaveBeenCalledTimes(1)
  expect(
    getDb().prepare("SELECT status,attempt_count FROM prototype_outbox WHERE kind='events'").get()
  ).toEqual({ status: 'pending', attempt_count: 0 })
  expect(getDb().prepare("SELECT status FROM prototype_jobs WHERE kind='sync'").get()).toEqual({
    status: 'pending'
  })
  await vi.advanceTimersByTimeAsync(2100)
  await drainPrototypeOutbox()
  await drainPrototypeOutbox()
  expect(state.request.mock.calls.map(([request]) => request.path)).toEqual([
    '/recordings/recording-a',
    '/recordings/recording-a',
    '/events/batch'
  ])
  expect(getDb().prepare("SELECT status FROM prototype_jobs WHERE kind='sync'").get()).toEqual({
    status: 'succeeded'
  })
})

it('기존 녹음 미등록 실패만 소유자별로 복구하고 다른 오류나 계정은 유지한다', async () => {
  const recoverable = queueRecordingEvent()
  const forbidden = queueRecordingEvent()
  const foreign = queueRecordingEvent('recording-b')
  getDb()
    .prepare("UPDATE prototype_outbox SET status='failed',last_error='Recording not found'")
    .run()
  getDb().prepare("UPDATE prototype_outbox SET last_error='Forbidden' WHERE id=?").run(forbidden)
  getDb().prepare("UPDATE prototype_outbox SET owner_id='owner-b' WHERE id=?").run(foreign)
  enqueueOutbox({ kind: 'recording', payload: { id: 'recording-a' } })
  enqueueOutbox({ kind: 'recording', payload: { id: 'recording-b' } })
  await drainPrototypeOutbox()
  await drainPrototypeOutbox()
  expect(
    getDb().prepare('SELECT status FROM prototype_outbox WHERE id=?').get(recoverable)
  ).toEqual({ status: 'succeeded' })
  for (const id of [forbidden, foreign]) {
    expect(getDb().prepare('SELECT status FROM prototype_outbox WHERE id=?').get(id)).toEqual({
      status: 'failed'
    })
  }
  expect(
    state.request.mock.calls.filter(([request]) => request.path === '/events/batch')
  ).toHaveLength(1)
})

it('대기 중인 녹음 이벤트가 20개를 넘어도 다른 이벤트 전송을 막지 않는다', async () => {
  for (let i = 0; i < 25; i++) queueRecordingEvent(`recording-${i}`)
  queueEvent()
  await drainPrototypeOutbox()
  expect(state.request).toHaveBeenCalledTimes(1)
  expect(state.request.mock.calls[0][0].body.events[0].eventType).toBe('copied')
})
