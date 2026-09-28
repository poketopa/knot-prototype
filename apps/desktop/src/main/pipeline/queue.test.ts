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

vi.mock('../prototype/authState', () => ({
  requirePrototypeUser: () => ({ id: 'owner-1', displayName: 'Owner' }),
  prototypeUserRoot: () => path.join(userDataDir, 'prototype', 'users', 'owner-1')
}))

vi.mock('./run', () => ({ runPipeline: vi.fn() }))
vi.mock('../summary/run', () => ({ runTopicAnalysis: vi.fn() }))
vi.mock('../glossary/draft', () => ({ runGlossaryDraft: vi.fn() }))
vi.mock('../prototype/documents', () => ({ listPrototypeDocuments: vi.fn(() => []) }))
describe('pipeline queue checkpoints', () => {
  beforeEach(async () => {
    vi.resetModules()
    userDataDir = await mkdtemp(path.join(os.tmpdir(), 'meeting-stt-prototype-queue-'))
  })

  afterEach(async () => {
    const { closeDb } = await import('../db/connection')
    closeDb()
    await rm(userDataDir, { recursive: true, force: true })
  })

  it('queues a missing publish outbox for an existing analysis exactly once', async () => {
    const { getDb } = await import('../db/connection')
    const { checkpointAiPublish } = await import('./queue')
    const db = getDb()
    db.prepare(
      `INSERT INTO prototype_artifacts (
         id, owner_id, recording_id, kind, local_path, content_json, sha256, byte_length,
         sync_status, created_at
       )
       VALUES (
         'analysis-1', 'owner-1', 'meeting-1', 'ai_analysis', NULL, '{"schemaVersion":1}',
         'a', 19, 'succeeded', 1
       )`
    ).run()

    checkpointAiPublish({ recordingId: 'meeting-1', analysisArtifactId: 'analysis-1' })
    checkpointAiPublish({ recordingId: 'meeting-1', analysisArtifactId: 'analysis-1' })

    const jobs = db
      .prepare(
        'SELECT kind, status, input_artifact_id, output_artifact_id FROM prototype_jobs ORDER BY kind'
      )
      .all() as Array<{
      kind: string
      status: string
      input_artifact_id: string | null
      output_artifact_id: string | null
    }>
    expect(jobs).toEqual([
      {
        kind: 'ai',
        status: 'succeeded',
        input_artifact_id: null,
        output_artifact_id: 'analysis-1'
      },
      {
        kind: 'publish',
        status: 'pending',
        input_artifact_id: 'analysis-1',
        output_artifact_id: null
      }
    ])
    const outbox = db
      .prepare("SELECT kind, payload_json FROM prototype_outbox WHERE kind = 'publish'")
      .all() as Array<{ kind: string; payload_json: string }>
    expect(outbox).toHaveLength(1)
    expect(JSON.parse(outbox[0].payload_json)).toEqual({
      recordingId: 'meeting-1',
      analysisArtifactId: 'analysis-1'
    })
  })

  it('does not reset an already succeeded publish job on retry', async () => {
    const { getDb } = await import('../db/connection')
    const { checkpointAiPublish } = await import('./queue')
    const db = getDb()
    db.prepare(
      `INSERT INTO prototype_jobs (
         id, owner_id, recording_id, kind, status, stage, input_artifact_id,
         created_at, updated_at
       )
       VALUES (
         'publish-job', 'owner-1', 'meeting-2', 'publish', 'succeeded', 'done',
         'analysis-2', 1, 1
       )`
    ).run()

    checkpointAiPublish({ recordingId: 'meeting-2', analysisArtifactId: 'analysis-2' })

    const publishJob = db
      .prepare("SELECT status, stage, input_artifact_id FROM prototype_jobs WHERE kind = 'publish'")
      .get() as { status: string; stage: string; input_artifact_id: string }
    expect(publishJob).toEqual({
      status: 'succeeded',
      stage: 'done',
      input_artifact_id: 'analysis-2'
    })
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM prototype_outbox WHERE kind = 'publish'").get()
    ).toEqual({
      count: 0
    })
  })

  it('rolls back ai and publish jobs when publish outbox insertion fails', async () => {
    const { getDb } = await import('../db/connection')
    const { checkpointAiPublish } = await import('./queue')
    const db = getDb()

    expect(() =>
      checkpointAiPublish({
        recordingId: 'meeting-3',
        analysisArtifactId: 'analysis-3',
        enqueue: () => {
          throw new Error('injected queue failure')
        }
      })
    ).toThrow('injected queue failure')

    expect(db.prepare('SELECT COUNT(*) AS count FROM prototype_jobs').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM prototype_outbox').get()).toEqual({ count: 0 })
  })
})
