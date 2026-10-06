import type { IncomingMessage } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'

import { isUuid, validateAiAnalysis } from '@meeting-stt/prototype-contracts/validate'
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
  AiAnalysisV2,
  AiComparison,
  ArtifactPutRequest,
  AuthAttemptRequest,
  AuthExchangeRequest,
  EventsBatchRequest,
  PublishRequest,
  RecordingPutRequest,
  SummarySelection,
  SummaryVariant
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
      return publishRecording(
        db,
        user,
        request.params.id,
        request.body.analysisArtifactId,
        request.body.transcriptArtifactId,
        request.body.replaceRecordingDocuments === true,
        request.body.selection
      )
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

  app.get('/v1/document-tree', async (request) => {
    const user = await authenticate(db, request)
    await backfillLegacyDocumentTree(db, user.id)
    const documents = await db.query<DocumentTreeItemRow>(
      `SELECT d.id,
              d.title,
              d.overview,
              d.recording_id,
              d.recording_started_at,
              d.latest_version,
              d.updated_at,
              r.duration_ms,
              dd.name AS domain
       FROM document_tree_documents d
       JOIN document_domains dd ON dd.user_id = d.user_id AND dd.id = d.domain_id
       JOIN recordings r ON r.user_id = d.user_id AND r.id = d.recording_id
       WHERE d.user_id = $1 AND d.is_active = true
       ORDER BY dd.name ASC, d.recording_started_at DESC, d.title ASC`,
      [user.id]
    )
    return { documents: documents.rows.map(mapDocumentTreeItem) }
  })

  app.get('/v1/document-classification', async (request) => {
    const user = await authenticate(db, request)
    await backfillLegacyDocumentTree(db, user.id)
    const documents = await selectClassificationDocuments(db, user.id)
    const revision = revisionForClassificationDocuments(documents)
    return {
      revision,
      baseRevision: revision,
      documents: documents.map(mapClassificationDocument)
    }
  })

  app.post<{ Body: DocumentClassificationApplyRequest }>(
    '/v1/document-classification',
    { schema: { body: documentClassificationApplyRequestSchema } },
    async (request) => {
      const user = await authenticate(db, request)
      await backfillLegacyDocumentTree(db, user.id)
      const payloadHash = canonicalHash(request.body)
      return withTransaction(db, async (client) => {
        await lockUserDocumentTree(client, user.id)
        const insertedRequest = await client.query(
          `INSERT INTO document_classification_requests (user_id, request_id, payload_hash)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, request_id) DO NOTHING`,
          [user.id, request.body.requestId, payloadHash]
        )
        if (insertedRequest.rowCount === 0) {
          const existing = await client.query<{
            payload_hash: string
            response: unknown | null
          }>(
            `SELECT payload_hash, response
             FROM document_classification_requests
             WHERE user_id = $1 AND request_id = $2
             FOR UPDATE`,
            [user.id, request.body.requestId]
          )
          if (existing.rowCount !== 1) {
            throw new ApiError(404, 'CLASSIFICATION_REQUEST_NOT_FOUND', 'Request not found')
          }
          assertSameHash(existing.rows[0].payload_hash, payloadHash)
          if (existing.rows[0].response) {
            return existing.rows[0].response
          }
          throw new ApiError(
            409,
            'CLASSIFICATION_REQUEST_IN_PROGRESS',
            'Classification request is already in progress',
            true
          )
        }

        const documents = await selectClassificationDocuments(client, user.id, true)
        const currentRevision = revisionForClassificationDocuments(documents)
        if (currentRevision !== request.body.baseRevision) {
          throw new ApiError(
            409,
            'DOCUMENT_CLASSIFICATION_REVISION_CONFLICT',
            'Documents changed after classification input was loaded'
          )
        }

        assertCompleteClassificationAssignments(documents, request.body.assignments)

        const rowsById = new Map(documents.map((document) => [document.id, document]))
        let changedCount = 0
        for (const assignment of request.body.assignments) {
          const document = rowsById.get(assignment.documentId)
          if (!document) {
            throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Document not found')
          }
          const nextDomainId = await upsertDocumentDomain(client, user.id, assignment.domain)
          if (nextDomainId === document.domain_id) {
            continue
          }
          await client.query(
            `UPDATE document_tree_documents
             SET domain_id = $1,
                 updated_at = now()
             WHERE user_id = $2 AND id = $3`,
            [nextDomainId, user.id, assignment.documentId]
          )
          await client.query(
            `INSERT INTO document_classification_changes (
               user_id,
               request_id,
               document_id,
               from_domain_id,
               to_domain_id,
               from_domain_name,
               to_domain_name,
               base_revision
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              user.id,
              request.body.requestId,
              assignment.documentId,
              document.domain_id,
              nextDomainId,
              document.domain,
              assignment.domain.trim(),
              request.body.baseRevision
            ]
          )
          changedCount += 1
        }

        const updatedDocuments = await selectClassificationDocuments(client, user.id)
        const revision = revisionForClassificationDocuments(updatedDocuments)
        const response = {
          revision,
          baseRevision: revision,
          changedCount,
          documents: updatedDocuments.map(mapClassificationDocument)
        }
        await client.query(
          `UPDATE document_classification_requests
           SET response = $1,
               completed_at = now()
           WHERE user_id = $2 AND request_id = $3`,
          [JSON.stringify(response), user.id, request.body.requestId]
        )
        return response
      })
    }
  )

  app.get<{ Params: { id: string } }>(
    '/v1/document-tree/:id',
    { schema: { params: uuidParamSchema('id') } },
    async (request) => {
      const user = await authenticate(db, request)
      await backfillLegacyDocumentTree(db, user.id)
      const document = await db.query<DocumentTreeDetailRow>(
        `SELECT d.id,
                d.title,
                d.overview,
                d.recording_id,
                d.recording_started_at,
                d.latest_version,
                d.updated_at,
                d.transcript_artifact_id,
                r.duration_ms,
                s.id AS snapshot_id,
                s.body,
                dd.name AS domain
         FROM document_tree_documents d
         JOIN document_domains dd ON dd.user_id = d.user_id AND dd.id = d.domain_id
         JOIN recordings r ON r.user_id = d.user_id AND r.id = d.recording_id
         JOIN document_tree_snapshots s ON s.user_id = d.user_id AND s.id = d.latest_snapshot_id
         WHERE d.user_id = $1 AND d.id = $2`,
        [user.id, request.params.id]
      )
      if (document.rowCount !== 1) {
        throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Document not found')
      }
      const row = document.rows[0]
      return {
        ...mapDocumentTreeItem(row),
        body: row.body,
        transcriptArtifactId: row.transcript_artifact_id,
        durationSec: Math.floor(row.duration_ms / 1000),
        snapshotId: row.snapshot_id
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

const documentClassificationApplyRequestSchema = {
  type: 'object',
  required: ['requestId', 'baseRevision', 'assignments'],
  properties: {
    requestId: { type: 'string', format: 'uuid' },
    baseRevision: { type: 'string', minLength: 1, maxLength: 128 },
    assignments: {
      type: 'array',
      items: {
        type: 'object',
        required: ['documentId', 'domain'],
        properties: {
          documentId: { type: 'string', format: 'uuid' },
          domain: { type: 'string', minLength: 1, maxLength: 160 }
        },
        additionalProperties: false
      }
    }
  },
  additionalProperties: false
} as const

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
  analysisArtifactId: string,
  transcriptArtifactId?: string,
  replaceRecordingDocuments = false,
  selection?: SummarySelection
) {
  return withTransaction(db, async (client) => {
    await lockUserDocumentTree(client, user.id)
    const recording = await client.query<RecordingRow>(
      'SELECT * FROM recordings WHERE user_id = $1 AND id = $2 FOR UPDATE',
      [user.id, recordingId]
    )
    if (recording.rowCount !== 1) {
      throw new ApiError(404, 'RECORDING_NOT_FOUND', 'Recording not found')
    }
    if (!selection) {
      await assertNoComparisonBypass({ client, userId: user.id, recordingId, analysisArtifactId })
      const replay = await client.query<{ response: unknown }>(
        'SELECT response FROM recording_publishes WHERE user_id = $1 AND recording_id = $2 AND analysis_artifact_id = $3',
        [user.id, recordingId, analysisArtifactId]
      )
      if (replay.rowCount === 1) {
        return replay.rows[0].response
      }
    }
    if (
      recording.rows[0].published_analysis_id &&
      recording.rows[0].published_analysis_id !== analysisArtifactId &&
      !replaceRecordingDocuments
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
    const transcript = await selectPublishTranscript(
      client,
      user.id,
      recordingId,
      analysis.rows[0],
      transcriptArtifactId
    )
    if (transcript.rowCount !== 1 || transcript.rows[0].raw_content === null) {
      throw new ApiError(
        422,
        'TRANSCRIPT_ARTIFACT_REQUIRED',
        'Publish requires a completed transcript artifact'
      )
    }
    const utteranceIds = extractUtteranceIds(transcript.rows[0].raw_content)
    if (selection) {
      const preference = await prepareSummaryPreference({
        client,
        userId: user.id,
        recordingId,
        analysisArtifactId,
        transcript: transcript.rows[0],
        utteranceIds,
        selection
      })
      if (preference) {
        await recordSummaryPreference({ client, userId: user.id, recordingId, preference })
      }
      const replay = await client.query<{ response: unknown }>(
        'SELECT response FROM recording_publishes WHERE user_id = $1 AND recording_id = $2 AND analysis_artifact_id = $3',
        [user.id, recordingId, analysisArtifactId]
      )
      if (replay.rowCount === 1) {
        return replay.rows[0].response
      }
    }

    const ai = validatePublishAiAnalysis(analysis.rows[0].raw_content)
    validateSourceRefs(ai, utteranceIds)
    if (ai.schemaVersion === 2) {
      return publishRecordingV2({
        client,
        user,
        recording: recording.rows[0],
        transcript: transcript.rows[0],
        analysisArtifactId,
        ai,
        replaceRecordingDocuments
      })
    }
    if (replaceRecordingDocuments) {
      throw new ApiError(422, 'AI_REANALYSIS_V2_REQUIRED', 'Reanalysis requires V2 documents')
    }
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

function validatePublishAiAnalysis(value: unknown) {
  try {
    return validateAiAnalysis(value)
  } catch (error) {
    throw new ApiError(
      422,
      error instanceof Error ? error.message : 'AI_RESULT_INVALID_SHAPE',
      'AI analysis result is invalid'
    )
  }
}

async function selectPublishTranscript(
  client: DbClient,
  userId: string,
  recordingId: string,
  analysis: ArtifactRow,
  transcriptArtifactId?: string
) {
  if (transcriptArtifactId) {
    return client.query<ArtifactRow>(
      `SELECT * FROM artifacts
       WHERE user_id = $1
         AND recording_id = $2
         AND id = $3
         AND kind = 'transcript'
         AND completed_at IS NOT NULL`,
      [userId, recordingId, transcriptArtifactId]
    )
  }
  return client.query<ArtifactRow>(
    `SELECT * FROM artifacts
     WHERE user_id = $1
       AND recording_id = $2
       AND kind = 'transcript'
       AND completed_at IS NOT NULL
       AND created_at <= $3
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, recordingId, analysis.created_at]
  )
}

type PreparedSummaryPreference = {
  comparisonArtifactId: string
  selectedAnalysisArtifactId: string
  rejectedAnalysisArtifactId: string
  candidateAAnalysisArtifactId: string
  candidateBAnalysisArtifactId: string
  transcriptArtifactId: string
  selectedVariant: SummaryVariant
  firstVariant: SummaryVariant
  reason: SummarySelection['reason']
  meetingType: SummarySelection['meetingType']
  otherReason: string | null
  selection: SummarySelection
}

async function prepareSummaryPreference({
  client,
  userId,
  recordingId,
  analysisArtifactId,
  transcript,
  utteranceIds,
  selection
}: {
  client: DbClient
  userId: string
  recordingId: string
  analysisArtifactId: string
  transcript: ArtifactRow
  utteranceIds: Set<string>
  selection?: SummarySelection
}): Promise<PreparedSummaryPreference | null> {
  if (!selection) {
    await assertNoComparisonBypass({ client, userId, recordingId, analysisArtifactId })
    return null
  }

  const comparison = await client.query<ArtifactRow>(
    `SELECT *
     FROM artifacts
     WHERE user_id = $1
       AND recording_id = $2
       AND id = $3
       AND kind = 'ai_comparison'
       AND completed_at IS NOT NULL`,
    [userId, recordingId, selection.comparisonArtifactId]
  )
  if (comparison.rowCount !== 1 || comparison.rows[0].raw_content === null) {
    throw new ApiError(404, 'COMPARISON_ARTIFACT_NOT_FOUND', 'Comparison artifact not found')
  }
  const content = validateAiComparison(comparison.rows[0].raw_content)
  if (content.transcriptArtifactId !== transcript.id) {
    throw new ApiError(
      422,
      'COMPARISON_TRANSCRIPT_MISMATCH',
      'Comparison transcript does not match publish transcript'
    )
  }
  const selectedAnalysisArtifactId = content.candidates[selection.selectedVariant]
  const rejectedVariant: SummaryVariant = selection.selectedVariant === 'A' ? 'B' : 'A'
  const rejectedAnalysisArtifactId = content.candidates[rejectedVariant]
  if (selectedAnalysisArtifactId !== analysisArtifactId) {
    throw new ApiError(
      422,
      'SUMMARY_SELECTION_ANALYSIS_MISMATCH',
      'Selected variant does not match analysis artifact'
    )
  }
  if (selectedAnalysisArtifactId === rejectedAnalysisArtifactId) {
    throw new ApiError(
      422,
      'COMPARISON_CANDIDATES_DUPLICATE',
      'Comparison candidates must be distinct'
    )
  }
  await assertComparisonCandidatesComplete({
    client,
    userId,
    recordingId,
    candidateAAnalysisArtifactId: content.candidates.A,
    candidateBAnalysisArtifactId: content.candidates.B,
    utteranceIds
  })
  const otherReason = selection.otherReason?.trim() || null
  if (otherReason && otherReason.length > 500) {
    throw new ApiError(400, 'OTHER_REASON_TOO_LONG', 'Other reason must be at most 500 characters')
  }
  return {
    comparisonArtifactId: selection.comparisonArtifactId,
    selectedAnalysisArtifactId,
    rejectedAnalysisArtifactId,
    candidateAAnalysisArtifactId: content.candidates.A,
    candidateBAnalysisArtifactId: content.candidates.B,
    transcriptArtifactId: content.transcriptArtifactId,
    selectedVariant: selection.selectedVariant,
    firstVariant: content.firstVariant,
    reason: selection.reason,
    meetingType: selection.meetingType,
    otherReason,
    selection: {
      comparisonArtifactId: selection.comparisonArtifactId,
      selectedVariant: selection.selectedVariant,
      reason: selection.reason,
      meetingType: selection.meetingType,
      ...(otherReason ? { otherReason } : {})
    }
  }
}

async function assertNoComparisonBypass({
  client,
  userId,
  recordingId,
  analysisArtifactId
}: {
  client: DbClient
  userId: string
  recordingId: string
  analysisArtifactId: string
}) {
  const comparisons = await client.query<{ raw_content: unknown }>(
    `SELECT raw_content
     FROM artifacts
     WHERE user_id = $1
       AND recording_id = $2
       AND kind = 'ai_comparison'
       AND completed_at IS NOT NULL
       AND raw_content IS NOT NULL`,
    [userId, recordingId]
  )
  for (const row of comparisons.rows) {
    const comparison = validateAiComparison(row.raw_content)
    if (
      comparison.candidates.A === analysisArtifactId ||
      comparison.candidates.B === analysisArtifactId
    ) {
      throw new ApiError(
        422,
        'SUMMARY_SELECTION_REQUIRED',
        'Publish requires summary selection for compared analyses'
      )
    }
  }
}

async function assertComparisonCandidatesComplete({
  client,
  userId,
  recordingId,
  candidateAAnalysisArtifactId,
  candidateBAnalysisArtifactId,
  utteranceIds
}: {
  client: DbClient
  userId: string
  recordingId: string
  candidateAAnalysisArtifactId: string
  candidateBAnalysisArtifactId: string
  utteranceIds: Set<string>
}) {
  const candidates = await client.query<{ id: string; raw_content: unknown }>(
    `SELECT id, raw_content
     FROM artifacts
     WHERE user_id = $1
       AND recording_id = $2
       AND kind = 'ai_analysis'
       AND completed_at IS NOT NULL
       AND raw_content IS NOT NULL
       AND id = ANY($3::uuid[])`,
    [userId, recordingId, [candidateAAnalysisArtifactId, candidateBAnalysisArtifactId]]
  )
  const ids = new Set(candidates.rows.map((row) => row.id))
  if (!ids.has(candidateAAnalysisArtifactId) || !ids.has(candidateBAnalysisArtifactId)) {
    throw new ApiError(
      422,
      'COMPARISON_CANDIDATE_NOT_FOUND',
      'Comparison candidates must be completed analysis artifacts for the same recording'
    )
  }
  for (const candidate of candidates.rows) {
    const ai = validatePublishAiAnalysis(candidate.raw_content)
    validateSourceRefs(ai, utteranceIds)
  }
}

async function recordSummaryPreference({
  client,
  userId,
  recordingId,
  preference
}: {
  client: DbClient
  userId: string
  recordingId: string
  preference: PreparedSummaryPreference
}) {
  const inserted = await client.query(
    `INSERT INTO recording_summary_preferences (
       user_id,
       recording_id,
       comparison_artifact_id,
       selected_analysis_artifact_id,
       rejected_analysis_artifact_id,
       candidate_a_analysis_artifact_id,
       candidate_b_analysis_artifact_id,
       transcript_artifact_id,
       selected_variant,
       first_variant,
       reason,
       meeting_type,
       other_reason,
       selection
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (user_id, recording_id) DO NOTHING`,
    [
      userId,
      recordingId,
      preference.comparisonArtifactId,
      preference.selectedAnalysisArtifactId,
      preference.rejectedAnalysisArtifactId,
      preference.candidateAAnalysisArtifactId,
      preference.candidateBAnalysisArtifactId,
      preference.transcriptArtifactId,
      preference.selectedVariant,
      preference.firstVariant,
      preference.reason,
      preference.meetingType,
      preference.otherReason,
      JSON.stringify(preference.selection)
    ]
  )
  if (inserted.rowCount === 1) return

  const existing = await client.query<{
    comparison_artifact_id: string
    selected_analysis_artifact_id: string
    rejected_analysis_artifact_id: string
    candidate_a_analysis_artifact_id: string
    candidate_b_analysis_artifact_id: string
    transcript_artifact_id: string
    selected_variant: SummaryVariant
    first_variant: SummaryVariant
    reason: SummarySelection['reason']
    meeting_type: SummarySelection['meetingType']
    other_reason: string | null
  }>(
    `SELECT comparison_artifact_id,
            selected_analysis_artifact_id,
            rejected_analysis_artifact_id,
            candidate_a_analysis_artifact_id,
            candidate_b_analysis_artifact_id,
            transcript_artifact_id,
            selected_variant,
            first_variant,
            reason,
            meeting_type,
            other_reason
     FROM recording_summary_preferences
     WHERE user_id = $1 AND recording_id = $2`,
    [userId, recordingId]
  )
  if (existing.rowCount === 1) {
    const row = existing.rows[0]
    if (
      row.comparison_artifact_id === preference.comparisonArtifactId &&
      row.selected_analysis_artifact_id === preference.selectedAnalysisArtifactId &&
      row.rejected_analysis_artifact_id === preference.rejectedAnalysisArtifactId &&
      row.candidate_a_analysis_artifact_id === preference.candidateAAnalysisArtifactId &&
      row.candidate_b_analysis_artifact_id === preference.candidateBAnalysisArtifactId &&
      row.transcript_artifact_id === preference.transcriptArtifactId &&
      row.selected_variant === preference.selectedVariant &&
      row.first_variant === preference.firstVariant &&
      row.reason === preference.reason &&
      row.meeting_type === preference.meetingType &&
      row.other_reason === preference.otherReason
    ) {
      return
    }
    throw new ApiError(409, 'SUMMARY_SELECTION_CONFLICT', 'Recording summary selection differs')
  }
  throw new ApiError(409, 'SUMMARY_SELECTION_CONFLICT', 'Recording summary selection differs')
}

function validateAiComparison(value: unknown): AiComparison {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.candidates)) {
    throw new ApiError(422, 'AI_COMPARISON_INVALID', 'AI comparison artifact is invalid')
  }
  const transcriptArtifactId = value.transcriptArtifactId
  const candidateA = value.candidates.A
  const candidateB = value.candidates.B
  const firstVariant = value.firstVariant
  if (
    !isUuid(transcriptArtifactId) ||
    !isUuid(candidateA) ||
    !isUuid(candidateB) ||
    (firstVariant !== 'A' && firstVariant !== 'B')
  ) {
    throw new ApiError(422, 'AI_COMPARISON_INVALID', 'AI comparison artifact is invalid')
  }
  return {
    schemaVersion: 1,
    transcriptArtifactId,
    candidates: { A: candidateA, B: candidateB },
    firstVariant
  }
}

async function publishRecordingV2({
  client,
  user,
  recording,
  transcript,
  analysisArtifactId,
  ai,
  replaceRecordingDocuments
}: {
  client: DbClient
  user: AuthenticatedUser
  recording: RecordingRow
  transcript: ArtifactRow
  analysisArtifactId: string
  ai: AiAnalysisV2
  replaceRecordingDocuments: boolean
}) {
  const documents = []
  const topicDocumentIds = new Set<string>()
  for (const topic of ai.topics) {
    if (topicDocumentIds.has(topic.documentId)) {
      throw new ApiError(422, 'AI_TOPIC_DOCUMENT_ID_DUPLICATE', 'Topic document id is duplicated')
    }
    topicDocumentIds.add(topic.documentId)
    const domainId = await upsertDocumentDomain(client, user.id, topic.domain)
    const body = {
      schemaVersion: 2,
      summarySections: topic.summarySections,
      outline: topic.outline
    }
    const overview = topic.summarySections[0]?.text
    await client.query(
      `INSERT INTO document_tree_documents (
         id,
         user_id,
         domain_id,
         title,
         overview,
         recording_id,
         recording_started_at,
         transcript_artifact_id,
         analysis_artifact_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (user_id, id) DO NOTHING`,
      [
        topic.documentId,
        user.id,
        domainId,
        topic.title,
        overview ?? null,
        recording.id,
        recording.started_at,
        transcript.id,
        analysisArtifactId
      ]
    )
    const existing = await client.query<{
      recording_id: string
      transcript_artifact_id: string
      analysis_artifact_id: string
      latest_version: number
      latest_snapshot_id: string | null
      title: string
      updated_at: Date
    }>(
      `SELECT recording_id,
              transcript_artifact_id,
              analysis_artifact_id,
              latest_version,
              latest_snapshot_id,
              title,
              updated_at
       FROM document_tree_documents
       WHERE user_id = $1 AND id = $2
       FOR UPDATE`,
      [user.id, topic.documentId]
    )
    if (existing.rowCount !== 1) {
      throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Document not found')
    }
    const existingRow = existing.rows[0]
    if (
      existingRow.recording_id !== recording.id ||
      existingRow.transcript_artifact_id !== transcript.id ||
      existingRow.analysis_artifact_id !== analysisArtifactId
    ) {
      throw new ApiError(
        409,
        'DOCUMENT_ID_ALREADY_USED',
        'Document id is already bound to another recording'
      )
    }
    if (existingRow.latest_version === 0) {
      const snapshot = await client.query<{ id: string; created_at: Date }>(
        `INSERT INTO document_tree_snapshots (
           user_id,
           document_id,
           version,
           body,
           recording_id,
           transcript_artifact_id,
           analysis_artifact_id
         )
         VALUES ($1, $2, 1, $3, $4, $5, $6)
         RETURNING id, created_at`,
        [
          user.id,
          topic.documentId,
          JSON.stringify(body),
          recording.id,
          transcript.id,
          analysisArtifactId
        ]
      )
      await client.query(
        `UPDATE document_tree_documents
         SET latest_snapshot_id = $1,
             latest_version = 1,
             updated_at = $2
         WHERE user_id = $3 AND id = $4`,
        [snapshot.rows[0].id, snapshot.rows[0].created_at, user.id, topic.documentId]
      )
      documents.push({
        id: topic.documentId,
        title: topic.title,
        latestVersion: 1,
        updatedAt: snapshot.rows[0].created_at.toISOString()
      })
      continue
    }
    documents.push({
      id: topic.documentId,
      title: existingRow.title,
      latestVersion: existingRow.latest_version,
      updatedAt: existingRow.updated_at.toISOString()
    })
  }
  if (replaceRecordingDocuments) {
    await client.query(
      `UPDATE document_tree_documents SET is_active = false
       WHERE user_id = $1 AND recording_id = $2 AND analysis_artifact_id <> $3`,
      [user.id, recording.id, analysisArtifactId]
    )
  }
  const response = { documents }
  await client.query(
    `INSERT INTO recording_publishes (user_id, recording_id, analysis_artifact_id, response)
     VALUES ($1, $2, $3, $4)`,
    [user.id, recording.id, analysisArtifactId, JSON.stringify(response)]
  )
  await client.query(
    'UPDATE recordings SET published_analysis_id = $1 WHERE user_id = $2 AND id = $3',
    [analysisArtifactId, user.id, recording.id]
  )
  return response
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

function validateSourceRefs(ai: AiAnalysisV1 | AiAnalysisV2, utteranceIds: Set<string>) {
  const items =
    ai.schemaVersion === 1
      ? ai.topics.flatMap((topic) => [...topic.decisions, ...topic.unresolved])
      : ai.topics.flatMap((topic) => [
          ...topic.summarySections,
          ...topic.outline.flatMap((section) => section.items)
        ])
  for (const item of items) {
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

async function lockUserDocumentTree(db: Pick<Db, 'query'>, userId: string) {
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended('document-tree:' || $1, 0))", [
    userId
  ])
}

async function selectClassificationDocuments(db: Pick<Db, 'query'>, userId: string, lock = false) {
  return (
    await db.query<ClassificationDocumentRow>(
      `SELECT d.id,
              d.title,
              d.overview,
              d.recording_id,
              d.recording_started_at,
              d.latest_version,
              d.updated_at,
              d.domain_id,
              d.latest_snapshot_id,
              r.duration_ms,
              s.body,
              dd.name AS domain
       FROM document_tree_documents d
       JOIN document_domains dd ON dd.user_id = d.user_id AND dd.id = d.domain_id
       JOIN recordings r ON r.user_id = d.user_id AND r.id = d.recording_id
       JOIN document_tree_snapshots s ON s.user_id = d.user_id AND s.id = d.latest_snapshot_id
       WHERE d.user_id = $1 AND d.is_active = true
       ORDER BY d.id ASC
       ${lock ? 'FOR UPDATE OF d' : ''}`,
      [userId]
    )
  ).rows
}

function revisionForClassificationDocuments(documents: ClassificationDocumentRow[]) {
  return canonicalHash({
    documents: documents.map((document) => ({
      id: document.id,
      domainId: document.domain_id,
      domain: document.domain,
      latestSnapshotId: document.latest_snapshot_id,
      latestVersion: document.latest_version,
      overview: document.overview,
      updatedAt: document.updated_at.toISOString()
    }))
  })
}

function mapClassificationDocument(row: ClassificationDocumentRow) {
  return {
    id: row.id,
    title: row.title,
    domain: row.domain,
    recordingId: row.recording_id,
    recordingStartedAt: row.recording_started_at.toISOString(),
    latestVersion: row.latest_version,
    updatedAt: row.updated_at.toISOString(),
    durationSec: Math.floor(row.duration_ms / 1000),
    body: row.body,
    ...(row.overview ? { overview: row.overview } : {})
  }
}

function assertCompleteClassificationAssignments(
  documents: ClassificationDocumentRow[],
  assignments: DocumentClassificationAssignment[]
) {
  if (documents.length !== assignments.length) {
    throw new ApiError(
      422,
      'DOCUMENT_CLASSIFICATION_ASSIGNMENTS_INCOMPLETE',
      'Assignments must include every active document exactly once'
    )
  }
  const expectedIds = new Set(documents.map((document) => document.id))
  const actualIds = new Set<string>()
  for (const assignment of assignments) {
    if (actualIds.has(assignment.documentId)) {
      throw new ApiError(
        422,
        'DOCUMENT_CLASSIFICATION_ASSIGNMENT_DUPLICATE',
        'Document assignment is duplicated'
      )
    }
    actualIds.add(assignment.documentId)
    if (!expectedIds.has(assignment.documentId)) {
      throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Document not found')
    }
  }
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
      `SELECT id FROM domain_documents WHERE user_id = $1 AND id = $2
       UNION ALL
       SELECT id FROM document_tree_documents WHERE user_id = $1 AND id = $2
       LIMIT 1`,
      [user.id, refs.documentId]
    )
    if (document.rowCount !== 1) {
      throw new ApiError(404, 'DOCUMENT_NOT_FOUND', 'Document not found')
    }
  }
}

async function backfillLegacyDocumentTree(db: Db, userId: string) {
  const contributions = await db.query<LegacyContributionRow>(
    `SELECT c.id,
            c.document_id,
            c.recording_id,
            c.analysis_artifact_id,
            c.section,
            c.created_at AS contribution_created_at,
            d.title AS document_title,
            r.started_at AS recording_started_at,
            t.id AS transcript_artifact_id,
            s.id AS legacy_snapshot_id
     FROM document_contributions c
     JOIN domain_documents d ON d.user_id = c.user_id AND d.id = c.document_id
     JOIN recordings r ON r.user_id = c.user_id AND r.id = c.recording_id
     JOIN LATERAL (
       SELECT id
       FROM artifacts
       WHERE user_id = c.user_id
         AND recording_id = c.recording_id
         AND kind = 'transcript'
         AND completed_at IS NOT NULL
         AND created_at <= c.created_at
       ORDER BY created_at DESC
       LIMIT 1
     ) t ON true
     LEFT JOIN LATERAL (
       SELECT id
       FROM document_snapshots
       WHERE user_id = c.user_id
         AND document_id = c.document_id
         AND trigger_recording_id = c.recording_id
       ORDER BY version ASC
       LIMIT 1
     ) s ON true
     WHERE c.user_id = $1
       AND NOT EXISTS (
         SELECT 1
         FROM document_tree_documents td
         WHERE td.user_id = c.user_id
           AND td.legacy_contribution_id = c.id
       )
     ORDER BY r.started_at ASC, c.id ASC`,
    [userId]
  )
  for (const contribution of contributions.rows) {
    await withTransaction(db, async (client) => {
      await lockUserDocumentTree(client, userId)
      const domainId = await upsertDocumentDomain(client, userId, contribution.document_title)
      const documentId = legacyTreeDocumentId(contribution.document_id, contribution.recording_id)
      const body = legacySectionToV2Body(contribution.section)
      const overview = firstSummaryText(body)
      await client.query(
        `INSERT INTO document_tree_documents (
           id,
           user_id,
           domain_id,
           title,
           overview,
           recording_id,
           recording_started_at,
           transcript_artifact_id,
           analysis_artifact_id,
           legacy_document_id,
           legacy_contribution_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (user_id, legacy_contribution_id) DO NOTHING`,
        [
          documentId,
          userId,
          domainId,
          contribution.document_title,
          overview,
          contribution.recording_id,
          contribution.recording_started_at,
          contribution.transcript_artifact_id,
          contribution.analysis_artifact_id,
          contribution.document_id,
          contribution.id
        ]
      )
      const document = await client.query<{ latest_version: number }>(
        `SELECT latest_version
         FROM document_tree_documents
         WHERE user_id = $1 AND legacy_contribution_id = $2
         FOR UPDATE`,
        [userId, contribution.id]
      )
      if (document.rowCount !== 1 || document.rows[0].latest_version !== 0) {
        return
      }
      const snapshot = await client.query<{ id: string; created_at: Date }>(
        `INSERT INTO document_tree_snapshots (
           user_id,
           document_id,
           version,
           body,
           recording_id,
           transcript_artifact_id,
           analysis_artifact_id,
           legacy_snapshot_id
         )
         VALUES ($1, $2, 1, $3, $4, $5, $6, $7)
         RETURNING id, created_at`,
        [
          userId,
          documentId,
          JSON.stringify(body),
          contribution.recording_id,
          contribution.transcript_artifact_id,
          contribution.analysis_artifact_id,
          contribution.legacy_snapshot_id
        ]
      )
      await client.query(
        `UPDATE document_tree_documents
         SET latest_snapshot_id = $1,
             latest_version = 1,
             updated_at = $2
         WHERE user_id = $3 AND legacy_contribution_id = $4`,
        [snapshot.rows[0].id, snapshot.rows[0].created_at, userId, contribution.id]
      )
    })
  }
}

async function upsertDocumentDomain(db: Pick<Db, 'query'>, userId: string, name: string) {
  const displayName = name.trim()
  const normalizedName = normalizeDomainName(displayName)
  const domain = await db.query<{ id: string }>(
    `INSERT INTO document_domains (user_id, name, normalized_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, normalized_name)
     DO UPDATE SET name = document_domains.name, updated_at = document_domains.updated_at
     RETURNING id`,
    [userId, displayName, normalizedName]
  )
  return domain.rows[0].id
}

function normalizeDomainName(name: string) {
  const normalized = name.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
  if (!normalized) {
    throw new ApiError(422, 'AI_TOPIC_DOMAIN_REQUIRED', 'Topic domain is required')
  }
  return normalized
}

function legacyTreeDocumentId(sourceDocumentId: string, recordingId: string) {
  return uuidFromSha256(`legacy-document:${sourceDocumentId}:${recordingId}`)
}

function uuidFromSha256(value: string) {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function legacySectionToV2Body(section: unknown) {
  const legacy = isRecord(section) ? section : {}
  const overview = typeof legacy.overview === 'string' ? legacy.overview : ''
  const decisions = legacyItems(legacy.decisions)
  const unresolved = legacyItems(legacy.unresolved).map((item) => ({
    ...item,
    text: `아직 정해지지 않은 내용: ${item.text}`
  }))
  const items = [...decisions, ...unresolved]
  const summarySourceIds = uniqueSourceIds(items)
  const summaryText = overview || items.map((item) => item.text).join('\n')
  return {
    schemaVersion: 2 as const,
    summarySections: summaryText
      ? [{ heading: '핵심 내용', text: summaryText, sourceUtteranceIds: summarySourceIds }]
      : [],
    outline: items.length > 0 ? [{ heading: '논의한 내용', items }] : []
  }
}

function legacyItems(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.text !== 'string') {
      return []
    }
    return [
      {
        text: item.text,
        sourceUtteranceIds: Array.isArray(item.sourceUtteranceIds)
          ? item.sourceUtteranceIds.filter((id): id is string => typeof id === 'string')
          : []
      }
    ]
  })
}

function uniqueSourceIds(items: Array<{ sourceUtteranceIds: string[] }>) {
  return [...new Set(items.flatMap((item) => item.sourceUtteranceIds))]
}

function firstSummaryText(body: { summarySections: Array<{ text: string }> }) {
  return body.summarySections[0]?.text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

function mapDocumentTreeItem(row: DocumentTreeItemRow) {
  return {
    id: row.id,
    title: row.title,
    domain: row.domain,
    recordingId: row.recording_id,
    recordingStartedAt: row.recording_started_at.toISOString(),
    latestVersion: row.latest_version,
    updatedAt: row.updated_at.toISOString(),
    durationSec: Math.floor(row.duration_ms / 1000),
    ...(row.overview ? { overview: row.overview } : {})
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
  created_at: Date
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

type DocumentTreeItemRow = {
  id: string
  title: string
  domain: string
  overview: string | null
  recording_id: string
  recording_started_at: Date
  latest_version: number
  updated_at: Date
  duration_ms: number
}

type DocumentTreeDetailRow = DocumentTreeItemRow & {
  transcript_artifact_id: string
  snapshot_id: string
  body: unknown
}

type ClassificationDocumentRow = DocumentTreeItemRow & {
  domain_id: string
  latest_snapshot_id: string
  body: unknown
}

type DocumentClassificationAssignment = {
  documentId: string
  domain: string
}

type DocumentClassificationApplyRequest = {
  requestId: string
  baseRevision: string
  assignments: DocumentClassificationAssignment[]
}

type LegacyContributionRow = {
  id: string
  document_id: string
  recording_id: string
  analysis_artifact_id: string
  section: unknown
  contribution_created_at: Date
  document_title: string
  recording_started_at: Date
  transcript_artifact_id: string
  legacy_snapshot_id: string | null
}
