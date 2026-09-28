import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import type { PrototypeChangedEvent, PrototypeTrackEventRequest } from '@shared/prototype'
import { getDb } from '../db/connection'
import { requirePrototypeUser } from './authState'
import { enqueueOutbox } from './outbox'

export const emitPrototypeChanged = (event: PrototypeChangedEvent) => {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(IPC.events.prototypeChanged, event)
  })
}

const validId = (value?: string) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const nonNegativeInteger = (value?: number) => Number.isSafeInteger(value) && Number(value) >= 0

export const trackPrototypeEvent = (input: PrototypeTrackEventRequest) => {
  const request: PrototypeTrackEventRequest = {
    eventType: input.eventType,
    ...(validId(input.eventId) ? { eventId: input.eventId } : {}),
    ...(validId(input.recordingId) ? { recordingId: input.recordingId } : {}),
    ...(validId(input.documentId) ? { documentId: input.documentId } : {}),
    ...(validId(input.attemptId) ? { attemptId: input.attemptId } : {}),
    ...(input.stage ? { stage: input.stage } : {}),
    ...(nonNegativeInteger(input.version) && input.version! > 0 ? { version: input.version } : {}),
    ...(nonNegativeInteger(input.durationMs) ? { durationMs: input.durationMs } : {}),
    ...(input.errorCode && /^[A-Z][A-Z0-9_]{0,79}$/.test(input.errorCode)
      ? { errorCode: input.errorCode }
      : {}),
    ...(input.occurredAt &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(input.occurredAt) &&
    Number.isFinite(Date.parse(input.occurredAt))
      ? { occurredAt: input.occurredAt }
      : {})
  }
  const user = requirePrototypeUser()
  const eventId = request.eventId ?? randomUUID()
  const occurredAt = request.occurredAt ?? new Date().toISOString()
  const payload = {
    eventId,
    eventType: request.eventType,
    occurredAt,
    ...(request.recordingId ? { recordingId: request.recordingId } : {}),
    ...(request.documentId ? { documentId: request.documentId } : {}),
    ...(request.version ? { version: request.version } : {}),
    ...(request.stage ? { stage: request.stage } : {}),
    ...(request.attemptId ? { attemptId: request.attemptId } : {}),
    ...(request.durationMs !== undefined ? { durationMs: request.durationMs } : {}),
    ...(request.errorCode ? { errorCode: request.errorCode } : {})
  }

  getDb().transaction(() => {
    const inserted = getDb()
      .prepare(
        `INSERT OR IGNORE INTO prototype_events (
         id, owner_id, event_type, occurred_at, recording_id, document_id, version,
         stage, attempt_id, duration_ms, error_code, payload_json, sync_status, created_at
       )
       VALUES (
         @id, @ownerId, @eventType, @occurredAt, @recordingId, @documentId, @version,
         @stage, @attemptId, @durationMs, @errorCode, @payloadJson, 'pending', @createdAt
       )`
      )
      .run({
        id: eventId,
        ownerId: user.id,
        eventType: request.eventType,
        occurredAt,
        recordingId: request.recordingId ?? null,
        documentId: request.documentId ?? null,
        version: request.version ?? null,
        stage: request.stage ?? null,
        attemptId: request.attemptId ?? null,
        durationMs: request.durationMs ?? null,
        errorCode: request.errorCode ?? null,
        payloadJson: JSON.stringify(payload),
        createdAt: Date.now()
      })
    if (inserted.changes) enqueueOutbox({ kind: 'events', payload })
  })()
  emitPrototypeChanged({
    reason: 'event',
    recordingId: request.recordingId,
    documentId: request.documentId
  })
}
