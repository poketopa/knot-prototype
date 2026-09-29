import { randomUUID } from 'node:crypto'
import { getDb } from '../db/connection'
import { messageOf, warn } from '../log'
import {
  PrototypeApiError,
  prototypeRequest,
  prototypeUpload,
  type UploadDescriptor
} from './apiClient'
import { requirePrototypeUser, prototypeAuthState, isPrototypeAuthTransitioning } from './authState'
import { artifactLocalPath } from './artifacts'
import { emitPrototypeChanged } from './events'
import { upsertPrototypeJob } from './jobs'

export type PrototypeOutboxKind =
  'recording' | 'artifact' | 'artifact-upload' | 'publish' | 'events'

interface EnqueueOutboxParams {
  kind: PrototypeOutboxKind
  payload: unknown
  ownerId?: string
}

const now = () => Date.now()
let isDraining = false
let outboxSequence = 0

const nextCreatedAt = () => {
  outboxSequence = (outboxSequence + 1) % 1000
  return now() * 1000 + outboxSequence
}

const nextRetryAt = ({ attemptCount }: { attemptCount: number }) =>
  now() + Math.min(60_000, 1000 * 2 ** Math.min(attemptCount, 6))

export const enqueueOutbox = ({ kind, payload, ownerId }: EnqueueOutboxParams) => {
  const owner = ownerId ?? requirePrototypeUser().id
  const id = randomUUID()

  getDb()
    .prepare(
      `INSERT INTO prototype_outbox (
         id, owner_id, kind, payload_json, status, attempt_count, next_retry_at, created_at
       )
       VALUES (@id, @ownerId, @kind, @payloadJson, 'pending', 0, 0, @createdAt)`
    )
    .run({
      id,
      ownerId: owner,
      kind,
      payloadJson: JSON.stringify(payload),
      createdAt: nextCreatedAt()
    })

  return id
}

interface OutboxRow {
  id: string
  kind: PrototypeOutboxKind
  payload_json: string
  attempt_count: number
}

const markOutboxSucceeded = ({ id }: { id: string }) => {
  getDb()
    .prepare("UPDATE prototype_outbox SET status = 'succeeded', last_error = NULL WHERE id = ?")
    .run(id)
  emitPrototypeChanged({ reason: 'sync' })
}

const markArtifactSynced = ({ id }: { id: string }) => {
  getDb().prepare("UPDATE prototype_artifacts SET sync_status = 'succeeded' WHERE id = ?").run(id)
}

const markPublishSucceeded = ({ recordingId }: { recordingId: string }) => {
  getDb()
    .prepare(
      `UPDATE prototype_jobs
       SET status = 'succeeded', stage = 'done', last_error = NULL, updated_at = @updatedAt
       WHERE recording_id = @recordingId AND kind = 'publish'`
    )
    .run({ recordingId, updatedAt: now() })
}

const assertArtifactMetadataSynced = ({ artifactId }: { artifactId: string }) => {
  const pending = getDb()
    .prepare(
      `SELECT 1
       FROM prototype_outbox
       WHERE kind = 'artifact'
         AND json_extract(payload_json, '$.id') = @artifactId
         AND status != 'succeeded'
       LIMIT 1`
    )
    .get({ artifactId })
  if (pending) throw new Error('artifact metadata is not synced yet')
}

const markOutboxFailed = ({
  id,
  attemptCount,
  errorMessage,
  retryable
}: {
  id: string
  attemptCount: number
  errorMessage: string
  retryable: boolean
}) => {
  getDb()
    .prepare(
      `UPDATE prototype_outbox
       SET status = @status, attempt_count = @attemptCount, last_error = @errorMessage,
           next_retry_at = @nextRetryAt
       WHERE id = @id`
    )
    .run({
      id,
      status: retryable ? 'pending' : 'failed',
      attemptCount,
      errorMessage,
      nextRetryAt: retryable ? nextRetryAt({ attemptCount }) : 0
    })
  emitPrototypeChanged({ reason: 'sync' })
}

const readString = ({ payload, key }: { payload: Record<string, unknown>; key: string }) => {
  const value = payload[key]
  if (typeof value !== 'string' || !value) throw new Error(`outbox payload ${key} is invalid`)

  return value
}

const sendOutboxPayload = async ({
  kind,
  payload
}: {
  kind: PrototypeOutboxKind
  payload: Record<string, unknown>
}) => {
  if (kind === 'recording') {
    const id = readString({ payload, key: 'id' })
    const body = { ...payload }
    delete body.id
    await prototypeRequest({ method: 'PUT', path: `/recordings/${id}`, body })
    return
  }
  if (kind === 'artifact') {
    const id = readString({ payload, key: 'id' })
    const recordingId = readString({ payload, key: 'recordingId' })
    const body = { ...payload }
    delete body.id
    delete body.recordingId
    await prototypeRequest({
      method: 'PUT',
      path: `/recordings/${recordingId}/artifacts/${id}`,
      body
    })
    if (body.kind !== 'wav') markArtifactSynced({ id })
    return
  }
  if (kind === 'artifact-upload') {
    const id = readString({ payload, key: 'id' })
    assertArtifactMetadataSynced({ artifactId: id })
    const descriptor = await prototypeRequest<UploadDescriptor>({
      method: 'POST',
      path: `/artifacts/${id}/upload`
    })
    await prototypeUpload({
      path: descriptor.url,
      descriptor,
      localPath: artifactLocalPath({ artifactId: id })
    })
    await prototypeRequest({
      method: 'POST',
      path: `/artifacts/${id}/complete`,
      timeoutMs: 10 * 60_000
    })
    markArtifactSynced({ id })
    return
  }
  if (kind === 'publish') {
    const recordingId = readString({ payload, key: 'recordingId' })
    const body = { ...payload }
    delete body.recordingId
    await prototypeRequest({
      method: 'POST',
      path: `/recordings/${recordingId}/publish`,
      body
    })
    markPublishSucceeded({ recordingId })
    return
  }
  if (kind === 'events') {
    const stage = payload.stage
    const event = { ...payload }
    delete event.stage
    delete event.metadata
    const stages: Record<string, string> = {
      recording: 'recording',
      transcribing: 'transcription',
      summarizing: 'ai_analysis',
      publishing: 'document_publish',
      syncing: 'sync'
    }
    await prototypeRequest({
      method: 'POST',
      path: '/events/batch',
      body: {
        events: [
          {
            ...event,
            ...(typeof stage === 'string' && stages[stage]
              ? { metadata: { stage: stages[stage] } }
              : {})
          }
        ]
      }
    })
  }
}

export const drainPrototypeOutbox = async () => {
  if (
    isDraining ||
    isPrototypeAuthTransitioning() ||
    !prototypeAuthState().isAuthenticated ||
    prototypeAuthState().isSyncPaused
  )
    return
  isDraining = true
  try {
    const owner = requirePrototypeUser()
    // Older builds permanently failed events sent before recording finalization.
    getDb()
      .prepare(
        `UPDATE prototype_outbox AS event
         SET status = 'pending', next_retry_at = 0
         WHERE event.owner_id = @ownerId AND event.kind = 'events'
           AND event.status = 'failed' AND event.last_error = 'Recording not found'
           AND EXISTS (
             SELECT 1 FROM prototype_outbox recording
             WHERE recording.owner_id = event.owner_id AND recording.kind = 'recording'
               AND recording.status = 'succeeded'
               AND json_extract(recording.payload_json, '$.id') =
                   json_extract(event.payload_json, '$.recordingId')
           )`
      )
      .run({ ownerId: owner.id })
    const rows = getDb()
      .prepare(
        `SELECT id, kind, payload_json, attempt_count
         FROM prototype_outbox AS item
         WHERE owner_id = @ownerId AND status = 'pending' AND next_retry_at <= @now
           AND (kind != 'events' OR json_extract(payload_json, '$.recordingId') IS NULL
             OR EXISTS (
               SELECT 1 FROM prototype_outbox recording
               WHERE recording.owner_id = item.owner_id AND recording.kind = 'recording'
                 AND recording.status = 'succeeded'
                 AND json_extract(recording.payload_json, '$.id') =
                     json_extract(item.payload_json, '$.recordingId')
             ))
         ORDER BY CASE kind WHEN 'recording' THEN 0 WHEN 'artifact' THEN 1 WHEN 'artifact-upload' THEN 2 WHEN 'publish' THEN 3 ELSE 4 END, created_at, id
         LIMIT 20`
      )
      .all({ ownerId: owner.id, now: now() }) as OutboxRow[]

    for (const row of rows) {
      if (prototypeAuthState().isSyncPaused) break
      try {
        await sendOutboxPayload({
          kind: row.kind,
          payload: JSON.parse(row.payload_json) as Record<string, unknown>
        })
        markOutboxSucceeded({ id: row.id })
        if (row.kind === 'events') {
          const event = JSON.parse(row.payload_json) as { eventId: string }
          getDb()
            .prepare(
              "UPDATE prototype_events SET sync_status='succeeded' WHERE id=? AND owner_id=?"
            )
            .run(event.eventId, owner.id)
        }
        if (row.kind === 'publish') emitPrototypeChanged({ reason: 'documents' })
      } catch (caught) {
        const attemptCount = row.attempt_count + 1
        const errorMessage = messageOf(caught)
        const retryable =
          caught instanceof PrototypeApiError
            ? caught.status === 401 || caught.retryable || caught.status >= 500
            : true
        markOutboxFailed({ id: row.id, attemptCount, errorMessage, retryable })
        const failedPayload = JSON.parse(row.payload_json) as Record<string, unknown>
        const recordingId = row.kind === 'recording' ? failedPayload.id : failedPayload.recordingId
        if (row.kind !== 'events' && typeof recordingId === 'string') {
          upsertPrototypeJob({
            recordingId,
            kind: 'sync',
            status: retryable ? 'pending' : 'failed',
            stage: 'syncing',
            error: errorMessage
          })
        }
        warn(`프로토타입 동기화 실패(${row.kind}): ${errorMessage}`)
        if (caught instanceof PrototypeApiError && caught.status === 401) break
      }
    }
    getDb()
      .prepare(
        `UPDATE prototype_jobs SET status='succeeded',stage='done',last_error=NULL,updated_at=@now
      WHERE owner_id=@ownerId AND kind='sync' AND NOT EXISTS
      (SELECT 1 FROM prototype_outbox o WHERE o.owner_id=@ownerId AND o.kind!='events' AND o.status!='succeeded'
       AND CASE o.kind WHEN 'recording' THEN json_extract(o.payload_json, '$.id')
           ELSE json_extract(o.payload_json, '$.recordingId') END=prototype_jobs.recording_id)`
      )
      .run({ now: Date.now(), ownerId: owner.id })
  } finally {
    isDraining = false
  }
}

export const isPrototypeOutboxRunning = () => isDraining
