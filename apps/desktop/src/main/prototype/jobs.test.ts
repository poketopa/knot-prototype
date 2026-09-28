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

    retryPrototypeProcessing({ meetingId: 'meeting-3' })

    const outbox = db
      .prepare('SELECT status, last_error, next_retry_at FROM prototype_outbox WHERE id = ?')
      .get('outbox-failed') as { status: string; last_error: string | null; next_retry_at: number }
    expect(outbox).toEqual({ status: 'pending', last_error: null, next_retry_at: 0 })
    expect(retryPrototypeJobKinds({ meetingId: 'meeting-3' })).toEqual(
      expect.arrayContaining([{ kind: 'ai' }, { kind: 'sync' }])
    )
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
})
