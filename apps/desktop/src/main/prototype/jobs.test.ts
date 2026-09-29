import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir
  },
  BrowserWindow: {
    getAllWindows: () => []
  }
}))

vi.mock('./authState', () => ({
  requirePrototypeUser: () => ({ id: 'owner-1', displayName: 'Owner' }),
  prototypeUserRoot: () => path.join(userDataDir, 'prototype', 'users', 'owner-1')
}))

describe('prototype processing jobs', () => {
  beforeEach(async () => {
    vi.resetModules()
    userDataDir = await mkdtemp(path.join(os.tmpdir(), 'meeting-stt-prototype-jobs-'))
  })

  afterEach(async () => {
    const { closeDb } = await import('../db/connection')
    closeDb()
    await rm(userDataDir, { recursive: true, force: true })
  })

  it('returns one processing row per meeting and marks saved only after outbox ACKs', async () => {
    const { getDb } = await import('../db/connection')
    const { listPrototypeProcessing, upsertPrototypeJob } = await import('./jobs')
    const db = getDb()
    db.prepare(
      `INSERT INTO meetings (id, owner_id, title, created_at, duration_sec, status, audio_path)
       VALUES ('meeting-1', 'owner-1', '회의 1', 1, 10, 'done', '/tmp/meeting.wav')`
    ).run()

    upsertPrototypeJob({
      recordingId: 'meeting-1',
      kind: 'transcript',
      status: 'succeeded',
      stage: 'done'
    })
    upsertPrototypeJob({
      recordingId: 'meeting-1',
      kind: 'ai',
      status: 'succeeded',
      stage: 'done'
    })
    upsertPrototypeJob({
      recordingId: 'meeting-1',
      kind: 'publish',
      status: 'succeeded',
      stage: 'done'
    })
    db.prepare(
      `INSERT INTO prototype_outbox (
         id, owner_id, kind, payload_json, status, attempt_count, next_retry_at, created_at
       )
       VALUES (
         'outbox-1', 'owner-1', 'artifact-upload',
         '{"recordingId":"meeting-1","id":"artifact-1"}',
         'pending', 0, 0, 1
       )`
    ).run()

    expect(listPrototypeProcessing()).toEqual([
      expect.objectContaining({
        meetingId: 'meeting-1',
        status: 'succeeded',
        stage: 'done',
        saved: false
      })
    ])

    db.prepare("UPDATE prototype_outbox SET status = 'succeeded' WHERE id = 'outbox-1'").run()

    expect(listPrototypeProcessing()).toEqual([
      expect.objectContaining({
        meetingId: 'meeting-1',
        saved: false
      })
    ])

    const insertArtifact = db.prepare(
      `INSERT INTO prototype_artifacts (
         id, owner_id, recording_id, kind, local_path, content_json, sha256, byte_length,
         sync_status, created_at
       )
       VALUES (
         @id, 'owner-1', 'meeting-1', @kind, NULL, '{}',
         @sha256, 2, 'succeeded', 1
       )`
    )
    insertArtifact.run({
      id: 'artifact-wav',
      kind: 'wav',
      sha256: '0'.repeat(64)
    })
    insertArtifact.run({
      id: 'artifact-transcript',
      kind: 'transcript',
      sha256: '1'.repeat(64)
    })
    insertArtifact.run({
      id: 'artifact-analysis',
      kind: 'ai_analysis',
      sha256: '2'.repeat(64)
    })

    expect(listPrototypeProcessing()).toEqual([
      expect.objectContaining({
        meetingId: 'meeting-1',
        status: 'succeeded',
        stage: 'done',
        saved: true
      })
    ])

    db.prepare(
      `INSERT INTO prototype_outbox (
         id, owner_id, kind, payload_json, status, attempt_count, next_retry_at, created_at
       )
       VALUES (
         'outbox-event', 'owner-1', 'events',
         '{"recordingId":"meeting-1","eventType":"transcript_viewed"}',
         'pending', 0, 0, 2
       )`
    ).run()

    expect(listPrototypeProcessing()).toEqual([
      expect.objectContaining({
        meetingId: 'meeting-1',
        saved: true
      })
    ])
  })

  it('does not automatically recover failed jobs until the user retries', async () => {
    const { getDb } = await import('../db/connection')
    const { recoverPrototypeJobs, upsertPrototypeJob } = await import('./jobs')
    const db = getDb()
    db.prepare(
      `INSERT INTO meetings (id, owner_id, title, created_at, duration_sec, status, audio_path)
       VALUES ('meeting-2', 'owner-1', '회의 2', 1, 10, 'error', '/tmp/meeting.wav')`
    ).run()

    upsertPrototypeJob({
      recordingId: 'meeting-2',
      kind: 'ai',
      status: 'failed',
      stage: 'error',
      error: 'boom'
    })

    expect(recoverPrototypeJobs()).toEqual([])
  })

  it('resets failed outbox rows for a recording when the user retries processing', async () => {
    const { getDb } = await import('../db/connection')
    const { retryPrototypeProcessing, retryPrototypeJobKinds, upsertPrototypeJob } =
      await import('./jobs')
    const db = getDb()
    db.prepare(
      `INSERT INTO meetings (id, owner_id, title, created_at, duration_sec, status, audio_path)
       VALUES ('meeting-3', 'owner-1', '회의 3', 1, 10, 'done', '/tmp/meeting.wav')`
    ).run()
    upsertPrototypeJob({
      recordingId: 'meeting-3',
      kind: 'ai',
      status: 'failed',
      stage: 'error',
      error: 'boom'
    })
    db.prepare(
      `INSERT INTO prototype_outbox (
         id, owner_id, kind, payload_json, status, attempt_count, last_error, next_retry_at, created_at
       )
       VALUES (
         'outbox-failed', 'owner-1', 'artifact',
         '{"recordingId":"meeting-3","id":"artifact-3"}',
         'failed', 2, 'server rejected it', 999, 1
       )`
    ).run()

    expect(retryPrototypeJobKinds({ meetingId: 'meeting-3' })).toEqual([{ kind: 'ai' }])
    retryPrototypeProcessing({ meetingId: 'meeting-3' })

    const outbox = db
      .prepare('SELECT status, last_error, next_retry_at FROM prototype_outbox WHERE id = ?')
      .get('outbox-failed') as { status: string; last_error: string | null; next_retry_at: number }
    expect(outbox).toEqual({ status: 'pending', last_error: null, next_retry_at: 0 })
    expect(retryPrototypeJobKinds({ meetingId: 'meeting-3' })).toEqual([])
  })

  it('does not create sync work for analytics-only outbox failures', async () => {
    const { getDb } = await import('../db/connection')
    const { retryPrototypeProcessing, retryPrototypeJobKinds } = await import('./jobs')
    const db = getDb()
    db.prepare(
      `INSERT INTO meetings (id, owner_id, title, created_at, duration_sec, status, audio_path)
       VALUES ('meeting-4', 'owner-1', '회의 4', 1, 10, 'done', '/tmp/meeting.wav')`
    ).run()
    db.prepare(
      `INSERT INTO prototype_outbox (
         id, owner_id, kind, payload_json, status, attempt_count, last_error, next_retry_at, created_at
       )
       VALUES (
         'outbox-event-failed', 'owner-1', 'events',
         '{"recordingId":"meeting-4","eventType":"transcript_viewed"}',
         'failed', 2, 'offline', 999, 1
       )`
    ).run()

    retryPrototypeProcessing({ meetingId: 'meeting-4' })

    const outbox = db
      .prepare('SELECT status, last_error, next_retry_at FROM prototype_outbox WHERE id = ?')
      .get('outbox-event-failed') as {
      status: string
      last_error: string | null
      next_retry_at: number
    }
    expect(outbox).toEqual({ status: 'failed', last_error: 'offline', next_retry_at: 999 })
    expect(retryPrototypeJobKinds({ meetingId: 'meeting-4' })).toEqual([])
  })

  it('keeps running local AI visible alongside a storage failure and retries only storage', async () => {
    const { getDb } = await import('../db/connection')
    const {
      listPrototypeProcessing,
      retryPrototypeProcessing,
      retryPrototypeJobKinds,
      upsertPrototypeJob
    } = await import('./jobs')
    const db = getDb()
    db.prepare(
      `INSERT INTO meetings (id, owner_id, title, created_at, duration_sec, status, audio_path)
      VALUES ('meeting-5', 'owner-1', '회의 5', 1, 9000, 'done', '/tmp/meeting.wav')`
    ).run()
    upsertPrototypeJob({
      recordingId: 'meeting-5',
      kind: 'transcript',
      status: 'succeeded',
      stage: 'done'
    })
    upsertPrototypeJob({
      recordingId: 'meeting-5',
      kind: 'ai',
      status: 'running',
      stage: 'summarizing'
    })
    upsertPrototypeJob({
      recordingId: 'meeting-5',
      kind: 'sync',
      status: 'failed',
      stage: 'syncing',
      error: 'HTTP 413'
    })
    expect(listPrototypeProcessing()[0]).toMatchObject({
      status: 'running',
      stage: 'summarizing',
      syncError: 'HTTP 413',
      completedStages: ['recording', 'transcribing'],
      hasTranscript: true,
      canRetry: true
    })
    expect(retryPrototypeJobKinds({ meetingId: 'meeting-5' })).toEqual([{ kind: 'sync' }])
    retryPrototypeProcessing({ meetingId: 'meeting-5' })
    expect(db.prepare("SELECT status, stage FROM prototype_jobs WHERE kind='ai'").get()).toEqual({
      status: 'running',
      stage: 'summarizing'
    })
  })

  it('preserves completed recording and transcription indicators when AI fails', async () => {
    const { getDb } = await import('../db/connection')
    const { listPrototypeProcessing, upsertPrototypeJob } = await import('./jobs')
    getDb()
      .prepare(
        `INSERT INTO meetings (id, owner_id, title, created_at, duration_sec, status, audio_path)
      VALUES ('meeting-6', 'owner-1', '회의 6', 1, 9000, 'done', '/tmp/meeting.wav')`
      )
      .run()
    upsertPrototypeJob({
      recordingId: 'meeting-6',
      kind: 'transcript',
      status: 'succeeded',
      stage: 'done'
    })
    upsertPrototypeJob({
      recordingId: 'meeting-6',
      kind: 'ai',
      status: 'failed',
      stage: 'error',
      error: 'invalid JSON'
    })
    expect(listPrototypeProcessing()[0]).toMatchObject({
      status: 'failed',
      stage: 'error',
      error: 'invalid JSON',
      completedStages: ['recording', 'transcribing'],
      hasTranscript: true
    })
  })

  it('manual storage retry clears pending backoff without including pending or running local work', async () => {
    const { getDb } = await import('../db/connection')
    const { retryPrototypeProcessing, retryPrototypeJobKinds, upsertPrototypeJob } =
      await import('./jobs')
    const db = getDb()
    db.prepare(
      `INSERT INTO meetings (id, owner_id, title, created_at, duration_sec, status, audio_path)
      VALUES ('meeting-7', 'owner-1', '회의 7', 1, 9000, 'done', '/tmp/meeting.wav')`
    ).run()
    upsertPrototypeJob({
      recordingId: 'meeting-7',
      kind: 'transcript',
      status: 'running',
      stage: 'transcribing'
    })
    upsertPrototypeJob({
      recordingId: 'meeting-7',
      kind: 'ai',
      status: 'pending',
      stage: 'summarizing'
    })
    db.prepare(
      `INSERT INTO prototype_outbox
      (id, owner_id, kind, payload_json, status, attempt_count, next_retry_at, last_error, created_at)
      VALUES ('pending-upload', 'owner-1', 'artifact-upload', '{"recordingId":"meeting-7"}', 'pending', 2, 9999999999999, 'offline', 1)`
    ).run()
    expect(retryPrototypeJobKinds({ meetingId: 'meeting-7' })).toEqual([])
    retryPrototypeProcessing({ meetingId: 'meeting-7' })
    expect(
      db
        .prepare(
          "SELECT status, next_retry_at, last_error FROM prototype_outbox WHERE id='pending-upload'"
        )
        .get()
    ).toEqual({ status: 'pending', next_retry_at: 0, last_error: null })
    expect(
      db
        .prepare(
          "SELECT kind, status FROM prototype_jobs WHERE kind IN ('transcript', 'ai') ORDER BY kind"
        )
        .all()
    ).toEqual([
      { kind: 'ai', status: 'pending' },
      { kind: 'transcript', status: 'running' }
    ])
  })
})
