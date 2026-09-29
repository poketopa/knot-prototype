import type { IncomingMessage } from 'node:http'
import { randomUUID } from 'node:crypto'

import { validateAiAnalysis } from '@meeting-stt/prototype-contracts/validate'
import {
  artifactPutRequestSchema,
  authAttemptRequestSchema,
  authExchangeRequestSchema,
  eventsBatchRequestSchema,
  publishRequestSchema,
  recordingPutRequestSchema
} from '@meeting-stt/prototype-contracts/schemas'
import type {
  AiAnalysisV1,
  ArtifactPutRequest,
  AuthAttemptRequest,
  AuthExchangeRequest,
  EventsBatchRequest,
  PublishRequest,
  RecordingPutRequest
} from '@meeting-stt/prototype-contracts/types'
import Fastify, { type FastifyInstance } from 'fastify'

import {
  RealGithubProvider,
  authenticate,
  buildDesktopCallback,
  buildGithubAuthorizeUrl,
  newSessionToken,
  type AuthenticatedUser,
  type GithubProvider
} from './auth.js'
import type { AppConfig } from './config.js'
import { canonicalHash, pkceChallenge, randomToken, sha256Hex } from './crypto.js'
import type { Db, DbClient } from './db.js'
import { withTransaction } from './db.js'
import { ApiError, sendError } from './errors.js'
import { ChunkUploadStorage } from './storage/chunks.js'
import { LocalStorage } from './storage/local.js'
import { S3Storage } from './storage/s3.js'
import type { ArtifactStorage } from './storage/types.js'

export type ServerDeps = {
  config: AppConfig
  db: Db
  githubProvider?: GithubProvider
  storage?: ArtifactStorage
  chunkStorage?: ChunkUploadStorage
}

function createStorage(config: AppConfig): ArtifactStorage {
  if (config.storageDriver === 'local') return new LocalStorage(config.localStorageRoot)
  if (!config.s3) throw new Error('S3_CONFIG_REQUIRED')
  return new S3Storage(config.s3)
}

export function buildServer({
  config,
  db,
  githubProvider = new RealGithubProvider(config),
  storage = createStorage(config),
  chunkStorage = new ChunkUploadStorage(config.localStorageRoot)
}: ServerDeps): FastifyInstance {
  const authAttemptLimiter = new Map<string, { count: number; resetAt: number }>()
  const app = Fastify({
    logger: false,
    bodyLimit: config.jsonBodyLimitBytes,
    ajv: {
      customOptions: {
        removeAdditional: false
      }
    },
    genReqId: () => randomUUID()
  })

  app.addContentTypeParser('application/octet-stream', (_request, payload, done) => {
    done(null, payload)
  })

  app.setErrorHandler((error, request, reply) => sendError(error, request, reply))

  app.get('/health', async () => {
    await db.query('SELECT 1')
    return { ok: true }
  })

  app.post<{ Body: AuthAttemptRequest }>(
    '/v1/auth/attempts',
    { schema: { body: authAttemptRequestSchema } },
    async (request) => {
      assertGithubConfigured(config)
      enforceAuthAttemptLimit(authAttemptLimiter, request.ip)
      const state = randomToken()
      const githubVerifier = randomToken()
      const attempt = await db.query<{ id: string; expires_at: Date }>(
        `INSERT INTO auth_attempts (challenge, state_hash, github_verifier, expires_at)
         VALUES ($1, $2, $3, now() + interval '10 minutes')
         RETURNING id, expires_at`,
        [request.body.challenge, sha256Hex(state), githubVerifier]
      )
      return {
        attemptId: attempt.rows[0].id,
        authorizeUrl: buildGithubAuthorizeUrl(config, state, pkceChallenge(githubVerifier)),
        expiresAt: attempt.rows[0].expires_at.toISOString()
      }
    }
  )

  app.get<{ Querystring: { code?: string; state?: string } }>(
    '/v1/auth/github/callback',
    async (request, reply) => {
      const code = request.query.code
      const state = request.query.state
      if (!code || !state) {
        throw new ApiError(400, 'OAUTH_CALLBACK_INVALID', 'OAuth callback is missing code or state')
      }
      const redirectUrl = await withTransaction(db, async (client) => {
        const attempt = await client.query<{ id: string; github_verifier: string }>(
          `SELECT id, github_verifier
         FROM auth_attempts
         WHERE state_hash = $1
           AND expires_at > now()
           AND consumed_at IS NULL
         FOR UPDATE`,
          [sha256Hex(state)]
        )
        if (attempt.rowCount !== 1) {
          throw new ApiError(401, 'OAUTH_ATTEMPT_INVALID', 'OAuth attempt is invalid or expired')
        }

        const accessToken = await githubProvider.exchangeCode(code, attempt.rows[0].github_verifier)
        const githubUser = await githubProvider.getUser(accessToken)
        const displayName = githubUser.name || githubUser.login
        const user = await client.query<{ id: string }>(
          `INSERT INTO users (github_id, display_name)
         VALUES ($1, $2)
         ON CONFLICT (github_id) DO UPDATE SET display_name = EXCLUDED.display_name
         RETURNING id`,
          [githubUser.id, displayName]
        )
        const ticket = randomToken()
        await client.query(
          `UPDATE auth_attempts
         SET ticket_hash = $1,
             ticket_expires_at = now() + interval '60 seconds',
             user_id = $2
         WHERE id = $3`,
          [sha256Hex(ticket), user.rows[0].id, attempt.rows[0].id]
        )
        return buildDesktopCallback(config, attempt.rows[0].id, ticket)
      })

      return reply.redirect(redirectUrl, 302)
    }
  )

  app.post<{ Body: AuthExchangeRequest }>(
    '/v1/auth/exchange',
    { schema: { body: authExchangeRequestSchema } },
    async (request) => {
      return withTransaction(db, async (client) => {
        const attempt = await client.query<{ user_id: string; challenge: string }>(
          `SELECT user_id, challenge
           FROM auth_attempts
           WHERE id = $1
             AND ticket_hash = $2
             AND ticket_expires_at > now()
             AND consumed_at IS NULL
             AND user_id IS NOT NULL
           FOR UPDATE`,
          [request.body.attemptId, sha256Hex(request.body.ticket)]
        )
        if (attempt.rowCount !== 1) {
          throw new ApiError(401, 'AUTH_TICKET_INVALID', 'Auth ticket is invalid or expired')
        }
        if (pkceChallenge(request.body.verifier) !== attempt.rows[0].challenge) {
          throw new ApiError(401, 'PKCE_VERIFIER_INVALID', 'PKCE verifier does not match attempt')
        }

        const token = newSessionToken()
        const session = await client.query<{ expires_at: Date }>(
          `INSERT INTO sessions (user_id, token_hash, expires_at)
           VALUES ($1, $2, now() + interval '30 days')
           RETURNING expires_at`,
          [attempt.rows[0].user_id, sha256Hex(token)]
        )
        await client.query('UPDATE auth_attempts SET consumed_at = now() WHERE id = $1', [
          request.body.attemptId
        ])
        const user = await client.query<{ id: string; display_name: string }>(
          'SELECT id, display_name FROM users WHERE id = $1',
          [attempt.rows[0].user_id]
        )

        return {
          session: { token, expiresAt: session.rows[0].expires_at.toISOString() },
          user: { id: user.rows[0].id, displayName: user.rows[0].display_name }
        }
      })
    }
  )

  app.get('/v1/me', async (request) => {
    const user = await authenticate(db, request)
    return { id: user.id, displayName: user.displayName }
  })

  app.post('/v1/auth/logout', async (request) => {
    const authorization = request.headers.authorization
    if (authorization?.startsWith('Bearer ')) {
      await db.query(
        'UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
        [sha256Hex(authorization.slice('Bearer '.length))]
      )
    }
    return { revoked: true }
  })

  app.put<{ Params: { id: string }; Body: RecordingPutRequest }>(
    '/v1/recordings/:id',
    { schema: { params: uuidParamSchema('id'), body: recordingPutRequestSchema } },
    async (request) => {
      const user = await authenticate(db, request)
      const bodyHash = canonicalHash(request.body)
      const existing = await db.query<RecordingRow>(
        'SELECT * FROM recordings WHERE user_id = $1 AND id = $2',
        [user.id, request.params.id]
      )
      if (existing.rowCount === 1) {
        assertSameHash(existing.rows[0].metadata_hash, bodyHash)
        return mapRecording(existing.rows[0])
      }

      const inserted = await db.query<RecordingRow>(
        `INSERT INTO recordings (id, user_id, started_at, ended_at, duration_ms, title, metadata_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          request.params.id,
          user.id,
          request.body.startedAt,
          request.body.endedAt,
          request.body.durationMs,
          request.body.title ?? null,
          bodyHash
        ]
      )
      return mapRecording(inserted.rows[0])
    }
  )

  app.get<{ Params: { id: string } }>(
    '/v1/recordings/:id',
    { schema: { params: uuidParamSchema('id') } },
    async (request) => {
      const user = await authenticate(db, request)
      const recording = await db.query<RecordingRow>(
        'SELECT * FROM recordings WHERE user_id = $1 AND id = $2',
        [user.id, request.params.id]
      )
      if (recording.rowCount !== 1) {
        throw new ApiError(404, 'RECORDING_NOT_FOUND', 'Recording not found')
      }
      const artifacts = await db.query<ArtifactRow>(
        `SELECT a.*, u.status AS upload_status
       FROM artifacts a
       LEFT JOIN uploads u ON u.user_id = a.user_id AND u.artifact_id = a.id
       WHERE a.user_id = $1 AND a.recording_id = $2
       ORDER BY a.created_at`,
        [user.id, request.params.id]
      )
      return {
        ...mapRecording(recording.rows[0]),
        artifacts: artifacts.rows.map(mapArtifact)
      }
    }
  )

  app.put<{ Params: { recordingId: string; artifactId: string }; Body: ArtifactPutRequest }>(
    '/v1/recordings/:recordingId/artifacts/:artifactId',
    {
      schema: {
        params: twoUuidParamSchema('recordingId', 'artifactId'),
        body: artifactPutRequestSchema
      }
    },
    async (request) => {
      const user = await authenticate(db, request)
      if (request.body.byteLength > config.maxUploadBytes) {
        throw new ApiError(413, 'ARTIFACT_TOO_LARGE', 'Artifact exceeds configured byte limit')
      }
      const verifiedContent = verifyArtifactPayload(request.body)
      const contentHash = canonicalHash({
        recordingId: request.params.recordingId,
        ...request.body,
        content: request.body.kind === 'wav' ? null : verifiedContent
      })
      return withTransaction(db, async (client) => {
        await assertRecordingExists(client, user, request.params.recordingId)
        const existing = await client.query<ArtifactRow>(
          'SELECT * FROM artifacts WHERE user_id = $1 AND id = $2',
          [user.id, request.params.artifactId]
        )
        if (existing.rowCount === 1) {
          assertSameHash(existing.rows[0].content_hash, contentHash)
          if (request.body.kind === 'wav') {
            await client.query(
              `INSERT INTO uploads (artifact_id, user_id, status, expected_sha256, expected_byte_length)
               VALUES ($1, $2, 'pending', $3, $4)
               ON CONFLICT (user_id, artifact_id) DO NOTHING`,
              [request.params.artifactId, user.id, request.body.sha256, request.body.byteLength]
            )
          }
          return mapArtifact(existing.rows[0])
        }

        const storageKey =
          request.body.kind === 'wav'
            ? storage.keyFor(user.id, request.params.recordingId, request.params.artifactId)
            : null
        const inserted = await client.query<ArtifactRow>(
          `INSERT INTO artifacts (
             id, user_id, recording_id, kind, attempt_id, raw_content, storage_key, sha256, byte_length,
             provider, model, prompt_version, completed_at, content_hash
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           RETURNING *`,
          [
            request.params.artifactId,
            user.id,
            request.params.recordingId,
            request.body.kind,
            request.body.attemptId ?? null,
            request.body.kind === 'wav' ? null : JSON.stringify(verifiedContent),
            storageKey,
            request.body.sha256,
            request.body.byteLength,
            request.body.provider ?? null,
            request.body.model ?? null,
            request.body.promptVersion ?? null,
            request.body.kind === 'wav' ? null : new Date(),
            contentHash
          ]
        )
        if (request.body.kind === 'wav') {
          await client.query(
            `INSERT INTO uploads (artifact_id, user_id, status, expected_sha256, expected_byte_length)
             VALUES ($1, $2, 'pending', $3, $4)`,
            [request.params.artifactId, user.id, request.body.sha256, request.body.byteLength]
          )
        }
        return mapArtifact(inserted.rows[0])
      })
    }
  )

  app.post<{ Params: { id: string } }>(
    '/v1/artifacts/:id/upload',
    { schema: { params: uuidParamSchema('id') } },
    async (request) => {
      const user = await authenticate(db, request)
      const artifact = await getArtifact(db, user, request.params.id)
      if (artifact.kind !== 'wav') {
        throw new ApiError(
          400,
          'ARTIFACT_UPLOAD_NOT_REQUIRED',
          'Only WAV artifacts use upload descriptors'
        )
      }
      return uploadDescriptor(chunkStorage, user, artifact)
    }
  )

  app.get<{ Params: { id: string } }>(
    '/v1/artifacts/:id/upload',
    { schema: { params: uuidParamSchema('id') } },
    async (request) => {
      const user = await authenticate(db, request)
      const artifact = await getArtifact(db, user, request.params.id)
      if (artifact.kind !== 'wav') {
        throw new ApiError(
          400,
          'ARTIFACT_UPLOAD_NOT_REQUIRED',
          'Only WAV artifacts use upload descriptors'
        )
      }
      return uploadDescriptor(chunkStorage, user, artifact)
    }
  )

  app.put<{ Params: { id: string; index: string }; Body: IncomingMessage }>(
    '/v1/artifacts/:id/chunks/:index',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id', 'index'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            index: { type: 'string', pattern: '^[0-9]+$' }
          },
          additionalProperties: false
        }
      }
    },
    async (request) => {
      const user = await authenticate(db, request)
      const artifact = await getArtifact(db, user, request.params.id)
      if (!artifact.storage_key || artifact.kind !== 'wav') {
        throw new ApiError(400, 'ARTIFACT_NOT_FILE_BACKED', 'Artifact does not accept file content')
      }
      const expectedSha256 = request.headers['x-chunk-sha256']
      const contentLength = request.headers['content-length']
      if (typeof expectedSha256 !== 'string') {
        throw new ApiError(400, 'ARTIFACT_CHUNK_SHA256_REQUIRED', 'Chunk checksum is required')
      }
      if (typeof contentLength !== 'string') {
        throw new ApiError(400, 'ARTIFACT_CHUNK_LENGTH_REQUIRED', 'Chunk length is required')
      }
      const uploaded = await chunkStorage.putChunk({
        scope: { userId: user.id, artifactId: request.params.id },
        index: Number(request.params.index),
        input: request.body,
        expectedSha256,
        expectedByteLength: Number(contentLength),
        artifact: { sha256: artifact.sha256, byteLength: Number(artifact.byte_length) }
      })
      return uploaded
    }
  )

  app.put<{ Params: { id: string }; Body: IncomingMessage }>(
    '/v1/artifacts/:id/content',
    { schema: { params: uuidParamSchema('id') } },
    async (request) => {
      const user = await authenticate(db, request)
      const artifact = await getArtifact(db, user, request.params.id)
      if (!artifact.storage_key) {
        throw new ApiError(400, 'ARTIFACT_NOT_FILE_BACKED', 'Artifact does not accept file content')
      }
      const uploaded = await storage.putStream(artifact.storage_key, request.body, {
        sha256: artifact.sha256,
        byteLength: Number(artifact.byte_length)
      })
      await db.query(
        `UPDATE uploads
         SET status = 'completed',
             receipt = $1,
             completed_at = now(),
             updated_at = now()
         WHERE user_id = $2 AND artifact_id = $3`,
        [JSON.stringify(uploaded), user.id, request.params.id]
      )
      return { id: request.params.id, sha256: uploaded.sha256, byteLength: uploaded.byteLength }
    }
  )

  app.post<{ Params: { id: string } }>(
    '/v1/artifacts/:id/complete',
    { schema: { params: uuidParamSchema('id') } },
    async (request) => {
      const user = await authenticate(db, request)
      const artifact = await getArtifact(db, user, request.params.id)
      if (!artifact.storage_key) {
        return mapArtifact(artifact)
      }
      const expected = {
        sha256: artifact.sha256,
        byteLength: Number(artifact.byte_length)
      }
      const verified = await verifyOrFinalizeArtifact({
        storage,
        chunkStorage,
        user,
        artifact,
        expected
      })
      await db.query(
        `UPDATE uploads
       SET status = 'completed',
           receipt = COALESCE(receipt, '{}'::jsonb),
           completed_at = COALESCE(completed_at, now()),
           updated_at = now()
       WHERE user_id = $1 AND artifact_id = $2`,
        [user.id, request.params.id]
      )
      return {
        ...mapArtifact(artifact),
        sha256: verified.sha256,
        byteLength: verified.byteLength,
        completed: true
      }
    }
  )

  app.get<{ Params: { id: string } }>(
    '/v1/artifacts/:id/content',
    { schema: { params: uuidParamSchema('id') } },
    async (request, reply) => {
      const user = await authenticate(db, request)
      const artifact = await getArtifact(db, user, request.params.id)
      if (artifact.raw_content !== null) {
        return artifact.raw_content
      }
      if (!artifact.storage_key || artifact.upload_status !== 'completed') {
        throw new ApiError(404, 'ARTIFACT_CONTENT_NOT_READY', 'Artifact content is not ready')
      }
      return reply.type('application/octet-stream').send(await storage.stream(artifact.storage_key))
    }
  )

  app.post<{ Params: { id: string }; Body: PublishRequest }>(
    '/v1/recordings/:id/publish',
    { schema: { params: uuidParamSchema('id'), body: publishRequestSchema } },
    async (request) => {
      const user = await authenticate(db, request)
      return publishRecording(db, user, request.params.id, request.body.analysisArtifactId)
    }
  )

  app.get('/v1/documents', async (request) => {
    const user = await authenticate(db, request)
    const documents = await db.query<DocumentSummaryRow>(
      `SELECT id, title, latest_version, updated_at
       FROM domain_documents
       WHERE user_id = $1
       ORDER BY updated_at DESC, title ASC`,
      [user.id]
    )
    return { documents: documents.rows.map(mapDocumentSummary) }
  })

  app.get<{ Params: { id: string } }>(
    '/v1/documents/:id',
    { schema: { params: uuidParamSchema('id') } },
    async (request) => {
      const user = await authenticate(db, request)
      const document = await db.query<DocumentDetailRow>(
        `SELECT d.id, d.title, d.latest_version, d.updated_at, s.id AS snapshot_id, s.body
       FROM domain_documents d
       JOIN document_snapshots s ON s.user_id = d.user_id AND s.id = d.latest_snapshot_id
       WHERE d.user_id = $1 AND d.id = $2`,
        [user.id, request.params.id]
      )
      if (document.rowCount !== 1) {
        throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Document not found')
      }
      const row = document.rows[0]
      return {
        id: row.id,
        title: row.title,
        latestVersion: row.latest_version,
        updatedAt: row.updated_at.toISOString(),
        snapshotId: row.snapshot_id,
        body: row.body
      }
    }
  )

  app.post<{ Body: EventsBatchRequest }>(
    '/v1/events/batch',
    { schema: { body: eventsBatchRequestSchema } },
    async (request) => {
      const user = await authenticate(db, request)
      const accepted: string[] = []
      await withTransaction(db, async (client) => {
        for (const event of request.body.events) {
          const payloadHash = canonicalHash(event)
          const existing = await client.query<{ payload_hash: string }>(
            'SELECT payload_hash FROM events WHERE user_id = $1 AND id = $2',
            [user.id, event.eventId]
          )
          if (existing.rowCount === 1) {
            assertSameHash(existing.rows[0].payload_hash, payloadHash)
            accepted.push(event.eventId)
            continue
          }
          await assertEventReferences(client, user, {
            recordingId: event.recordingId,
            documentId: event.documentId
          })
          await client.query(
            `INSERT INTO events (
               id, user_id, event_type, occurred_at, recording_id, document_id, version,
               attempt_id, duration_ms, error_code, payload_hash, metadata
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
              event.eventId,
              user.id,
              event.eventType,
              event.occurredAt,
              event.recordingId ?? null,
              event.documentId ?? null,
              event.version ?? null,
              event.attemptId ?? null,
              event.durationMs ?? null,
              event.errorCode ?? null,
              payloadHash,
              JSON.stringify(event.metadata ?? {})
            ]
          )
          accepted.push(event.eventId)
        }
      })
      return { accepted }
    }
  )

  return app
}

async function uploadDescriptor(
  chunkStorage: ChunkUploadStorage,
  user: AuthenticatedUser,
  artifact: ArtifactRow
) {
  const completed = artifact.upload_status === 'completed'
  return {
    ...(await chunkStorage.descriptor(
      { userId: user.id, artifactId: artifact.id },
      { sha256: artifact.sha256, byteLength: Number(artifact.byte_length) },
      completed
    )),
    // Kept for older desktop builds that only know the one-shot upload endpoint.
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  }
}

async function verifyOrFinalizeArtifact({
  storage,
  chunkStorage,
  user,
  artifact,
  expected
}: {
  storage: ArtifactStorage
  chunkStorage: ChunkUploadStorage
  user: AuthenticatedUser
  artifact: ArtifactRow
  expected: { sha256: string; byteLength: number }
}) {
  if (!artifact.storage_key) {
    throw new ApiError(400, 'ARTIFACT_NOT_FILE_BACKED', 'Artifact does not accept file content')
  }
  try {
    return await storage.verify(artifact.storage_key, expected)
  } catch (error) {
    if (artifact.upload_status === 'completed') throw error
    if (!(error instanceof ApiError) || error.code !== 'ARTIFACT_CONTENT_HASH_MISMATCH') {
      throw error
    }
  }
  return chunkStorage.finalize({
    scope: { userId: user.id, artifactId: artifact.id },
    expected,
    put: (input) => storage.putStream(artifact.storage_key!, input, expected)
  })
}

function uuidParamSchema(name: string) {
  return {
    type: 'object',
    required: [name],
    properties: {
      [name]: { type: 'string', format: 'uuid' }
    },
    additionalProperties: false
  } as const
}

function twoUuidParamSchema(first: string, second: string) {
  return {
    type: 'object',
    required: [first, second],
    properties: {
      [first]: { type: 'string', format: 'uuid' },
      [second]: { type: 'string', format: 'uuid' }
    },
    additionalProperties: false
  } as const
}

function assertGithubConfigured(config: AppConfig) {
  if (!config.githubClientId || !config.githubClientSecret) {
    throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'GitHub OAuth is not configured')
  }
}

function enforceAuthAttemptLimit(
  limiter: Map<string, { count: number; resetAt: number }>,
  ip: string
) {
  const now = Date.now()
  const current = limiter.get(ip)
  if (!current || current.resetAt <= now) {
    limiter.set(ip, { count: 1, resetAt: now + 10 * 60 * 1000 })
    return
  }
  if (current.count >= 20) {
    throw new ApiError(429, 'AUTH_ATTEMPT_RATE_LIMITED', 'Too many login attempts', true)
  }
  current.count += 1
}

async function publishRecording(
  db: Db,
  user: AuthenticatedUser,
  recordingId: string,
  analysisArtifactId: string
) {
  return withTransaction(db, async (client) => {
    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user.id])
    const replay = await client.query<{ response: unknown }>(
      'SELECT response FROM recording_publishes WHERE user_id = $1 AND recording_id = $2 AND analysis_artifact_id = $3',
      [user.id, recordingId, analysisArtifactId]
    )
    if (replay.rowCount === 1) {
      return replay.rows[0].response
    }
    const recording = await client.query<RecordingRow>(
      'SELECT * FROM recordings WHERE user_id = $1 AND id = $2 FOR UPDATE',
      [user.id, recordingId]
    )
    if (recording.rowCount !== 1) {
      throw new ApiError(404, 'RECORDING_NOT_FOUND', 'Recording not found')
    }
    if (
      recording.rows[0].published_analysis_id &&
      recording.rows[0].published_analysis_id !== analysisArtifactId
    ) {
      throw new ApiError(
        409,
        'RECORDING_ALREADY_PUBLISHED',
        'Recording was already published with a different analysis'
      )
    }
    const analysis = await client.query<ArtifactRow>(
      `SELECT * FROM artifacts
       WHERE user_id = $1 AND recording_id = $2 AND id = $3 AND kind = 'ai_analysis' AND completed_at IS NOT NULL`,
      [user.id, recordingId, analysisArtifactId]
    )
    if (analysis.rowCount !== 1 || analysis.rows[0].raw_content === null) {
      throw new ApiError(404, 'ANALYSIS_ARTIFACT_NOT_FOUND', 'Analysis artifact not found')
    }
    const transcript = await client.query<ArtifactRow>(
      `SELECT * FROM artifacts
       WHERE user_id = $1 AND recording_id = $2 AND kind = 'transcript' AND completed_at IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [user.id, recordingId]
    )
    if (transcript.rowCount !== 1 || transcript.rows[0].raw_content === null) {
      throw new ApiError(
        422,
        'TRANSCRIPT_ARTIFACT_REQUIRED',
        'Publish requires a completed transcript artifact'
      )
    }

    const utteranceIds = extractUtteranceIds(transcript.rows[0].raw_content)
    const ai = validateAiAnalysis(analysis.rows[0].raw_content)
    validateSourceRefs(ai, utteranceIds)
    const topics = mergeTopics(ai)

    for (const topic of topics) {
      const documentId = topic.existingDocumentId ?? topic.newDocumentId
      if (!documentId) {
        throw new ApiError(422, 'AI_TOPIC_DOCUMENT_ID_MISSING', 'Topic document id is missing')
      }
      if (topic.existingDocumentId) {
        const existing = await client.query(
          'SELECT id FROM domain_documents WHERE user_id = $1 AND id = $2',
          [user.id, topic.existingDocumentId]
        )
        if (existing.rowCount !== 1) {
          throw new ApiError(422, 'DOCUMENT_REFERENCE_INVALID', 'AI referenced a missing document')
        }
      } else {
        await client.query(
          `INSERT INTO domain_documents (id, user_id, title)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, id) DO NOTHING`,
          [documentId, user.id, topic.title]
        )
      }
      await client.query(
        `INSERT INTO document_contributions (user_id, document_id, recording_id, analysis_artifact_id, section)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          user.id,
          documentId,
          recordingId,
          analysisArtifactId,
          JSON.stringify({
            recordingId,
            recordingStartedAt: recording.rows[0].started_at.toISOString(),
            overview: topic.overview,
            decisions: topic.decisions,
            unresolved: topic.unresolved
          })
        ]
      )
    }

    const documents = []
    for (const documentId of topics.map(
      (topic) => topic.existingDocumentId ?? topic.newDocumentId
    )) {
      if (!documentId) {
        continue
      }
      const summary = await snapshotDocument(
        client,
        user.id,
        documentId,
        recordingId,
        analysisArtifactId
      )
      documents.push(summary)
    }
    const response = { documents }
    await client.query(
      `INSERT INTO recording_publishes (user_id, recording_id, analysis_artifact_id, response)
       VALUES ($1, $2, $3, $4)`,
      [user.id, recordingId, analysisArtifactId, JSON.stringify(response)]
    )
    await client.query(
      'UPDATE recordings SET published_analysis_id = $1 WHERE user_id = $2 AND id = $3',
      [analysisArtifactId, user.id, recordingId]
    )
    return response
  })
}

async function snapshotDocument(
  client: DbClient,
  userId: string,
  documentId: string,
  recordingId: string,
  analysisArtifactId: string
) {
  const document = await client.query<{ title: string; latest_version: number }>(
    'SELECT title, latest_version FROM domain_documents WHERE user_id = $1 AND id = $2 FOR UPDATE',
    [userId, documentId]
  )
  if (document.rowCount !== 1) {
    throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Document not found')
  }
  const contributions = await client.query<{ section: unknown }>(
    `SELECT c.section
     FROM document_contributions c
     JOIN recordings r ON r.user_id = c.user_id AND r.id = c.recording_id
     WHERE c.user_id = $1 AND c.document_id = $2
     ORDER BY r.started_at ASC, r.id ASC`,
    [userId, documentId]
  )
  const version = document.rows[0].latest_version + 1
  const body = { sections: contributions.rows.map((row) => row.section) }
  const snapshot = await client.query<{ id: string; created_at: Date }>(
    `INSERT INTO document_snapshots (user_id, document_id, version, body, trigger_recording_id, analysis_artifact_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, created_at`,
    [userId, documentId, version, JSON.stringify(body), recordingId, analysisArtifactId]
  )
  await client.query(
    `UPDATE domain_documents
     SET latest_snapshot_id = $1,
         latest_version = $2,
         updated_at = $3
     WHERE user_id = $4 AND id = $5`,
    [snapshot.rows[0].id, version, snapshot.rows[0].created_at, userId, documentId]
  )
  return {
    id: documentId,
    title: document.rows[0].title,
    latestVersion: version,
    updatedAt: snapshot.rows[0].created_at.toISOString()
  }
}

function mergeTopics(ai: AiAnalysisV1): AiAnalysisV1['topics'] {
  const map = new Map<string, AiAnalysisV1['topics'][number]>()
  for (const topic of ai.topics) {
    const key = topic.existingDocumentId ?? topic.newDocumentId
    if (!key) {
      continue
    }
    const previous = map.get(key)
    if (!previous) {
      map.set(key, { ...topic, decisions: [...topic.decisions], unresolved: [...topic.unresolved] })
      continue
    }
    previous.overview = [previous.overview, topic.overview].filter(Boolean).join('\n\n')
    previous.decisions.push(...topic.decisions)
    previous.unresolved.push(...topic.unresolved)
  }
  return [...map.values()]
}

function validateSourceRefs(ai: AiAnalysisV1, utteranceIds: Set<string>) {
  for (const topic of ai.topics) {
    for (const item of [...topic.decisions, ...topic.unresolved]) {
      for (const sourceId of item.sourceUtteranceIds) {
        if (!utteranceIds.has(sourceId)) {
          throw new ApiError(
            422,
            'AI_SOURCE_UTTERANCE_ID_UNKNOWN',
            `Unknown source utterance id: ${sourceId}`
          )
        }
      }
    }
  }
}

function extractUtteranceIds(content: unknown) {
  if (
    !content ||
    typeof content !== 'object' ||
    !('utterances' in content) ||
    !Array.isArray(content.utterances)
  ) {
    throw new ApiError(
      422,
      'TRANSCRIPT_SHAPE_INVALID',
      'Transcript artifact must contain utterances[]'
    )
  }
  return new Set(
    content.utterances.map((utterance) => {
      if (
        !utterance ||
        typeof utterance !== 'object' ||
        !('id' in utterance) ||
        typeof utterance.id !== 'string'
      ) {
        throw new ApiError(
          422,
          'TRANSCRIPT_UTTERANCE_ID_INVALID',
          'Transcript utterance id is invalid'
        )
      }
      return utterance.id
    })
  )
}

function verifyArtifactPayload(body: ArtifactPutRequest) {
  if (body.kind === 'wav') {
    return null
  }
  if (body.content === undefined) {
    throw new ApiError(400, 'ARTIFACT_CONTENT_REQUIRED', 'JSON/text artifact content is required')
  }
  const bytes = Buffer.from(JSON.stringify(body.content))
  if (body.byteLength !== bytes.byteLength || body.sha256 !== sha256Hex(bytes)) {
    throw new ApiError(
      409,
      'ARTIFACT_CONTENT_HASH_MISMATCH',
      'Artifact metadata does not match JSON content bytes'
    )
  }
  return body.content
}

async function assertEventReferences(
  db: Pick<Db, 'query'>,
  user: AuthenticatedUser,
  refs: { recordingId?: string; documentId?: string }
) {
  if (refs.recordingId) {
    await assertRecordingExists(db, user, refs.recordingId)
  }
  if (refs.documentId) {
    const document = await db.query(
      'SELECT id FROM domain_documents WHERE user_id = $1 AND id = $2',
      [user.id, refs.documentId]
    )
    if (document.rowCount !== 1) {
      throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Document not found')
    }
  }
}

async function assertRecordingExists(
  db: Pick<Db, 'query'>,
  user: AuthenticatedUser,
  recordingId: string
) {
  const result = await db.query('SELECT id FROM recordings WHERE user_id = $1 AND id = $2', [
    user.id,
    recordingId
  ])
  if (result.rowCount !== 1) {
    throw new ApiError(404, 'RECORDING_NOT_FOUND', 'Recording not found')
  }
}

async function getArtifact(db: Db, user: AuthenticatedUser, artifactId: string) {
  const artifact = await db.query<ArtifactRow>(
    `SELECT a.*, u.status AS upload_status
     FROM artifacts a
     LEFT JOIN uploads u ON u.user_id = a.user_id AND u.artifact_id = a.id
     WHERE a.user_id = $1 AND a.id = $2`,
    [user.id, artifactId]
  )
  if (artifact.rowCount !== 1) {
    throw new ApiError(404, 'ARTIFACT_NOT_FOUND', 'Artifact not found')
  }
  return artifact.rows[0]
}

function assertSameHash(existing: string, incoming: string) {
  if (existing !== incoming) {
    throw new ApiError(
      409,
      'IDEMPOTENCY_CONFLICT',
      'Same id was already used with different payload'
    )
  }
}

function mapRecording(row: RecordingRow) {
  return {
    id: row.id,
    startedAt: row.started_at.toISOString(),
    endedAt: row.ended_at.toISOString(),
    durationMs: row.duration_ms,
    title: row.title,
    publishedAnalysisId: row.published_analysis_id
  }
}

function mapArtifact(row: ArtifactRow) {
  return {
    id: row.id,
    recordingId: row.recording_id,
    kind: row.kind,
    sha256: row.sha256,
    byteLength: Number(row.byte_length),
    provider: row.provider,
    model: row.model,
    promptVersion: row.prompt_version,
    completed: row.completed_at !== null || row.upload_status === 'completed'
  }
}

function mapDocumentSummary(row: DocumentSummaryRow) {
  return {
    id: row.id,
    title: row.title,
    latestVersion: row.latest_version,
    updatedAt: row.updated_at.toISOString()
  }
}

type RecordingRow = {
  id: string
  started_at: Date
  ended_at: Date
  duration_ms: number
  title: string | null
  metadata_hash: string
  published_analysis_id: string | null
}

type ArtifactRow = {
  id: string
  recording_id: string
  kind: string
  raw_content: unknown | null
  storage_key: string | null
  sha256: string
  byte_length: string | number
  provider: string | null
  model: string | null
  prompt_version: string | null
  completed_at: Date | null
  content_hash: string
  upload_status?: string | null
}

type DocumentSummaryRow = {
  id: string
  title: string
  latest_version: number
  updated_at: Date
}

type DocumentDetailRow = DocumentSummaryRow & {
  snapshot_id: string
  body: unknown
}
