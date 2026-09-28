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

describe('prototype analytics events', () => {
  beforeEach(async () => {
    vi.resetModules()
    userDataDir = await mkdtemp(path.join(os.tmpdir(), 'meeting-stt-prototype-events-'))
  })

  afterEach(async () => {
    const { closeDb } = await import('../db/connection')
    closeDb()
    await rm(userDataDir, { recursive: true, force: true })
  })

  it('does not persist arbitrary renderer metadata or transcript text', async () => {
    const { getDb } = await import('../db/connection')
    const { trackPrototypeEvent } = await import('./events')

    trackPrototypeEvent({
      eventId: '00000000-0000-4000-8000-000000000001',
      eventType: 'processing_stage_failed',
      occurredAt: '2026-09-28T00:00:00.000Z',
      recordingId: 'recording-1',
      stage: 'summarizing',
      transcriptText: 'secret transcript',
      metadata: { text: 'secret metadata' }
    } as Parameters<typeof trackPrototypeEvent>[0] & {
      transcriptText: string
      metadata: Record<string, string>
    })

    const db = getDb()
    const event = db
      .prepare('SELECT payload_json FROM prototype_events WHERE id = ?')
      .get('00000000-0000-4000-8000-000000000001') as { payload_json: string }
    const outbox = db
      .prepare('SELECT payload_json FROM prototype_outbox WHERE kind = ?')
      .get('events') as { payload_json: string }

    expect(event.payload_json).not.toContain('secret')
    expect(outbox.payload_json).not.toContain('secret')
    expect(JSON.parse(event.payload_json)).toMatchObject({
      eventType: 'processing_stage_failed',
      stage: 'summarizing'
    })
  })
})
