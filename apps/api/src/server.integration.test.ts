import { createHash } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { GithubProvider } from './auth.js'
import type { AppConfig } from './config.js'
import { pkceChallenge, sha256Hex } from './crypto.js'
import { createPool, type Db } from './db.js'
import { migrate } from './migrate.js'
import { buildServer } from './server.js'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const runtimeDatabaseUrl =
  process.env.TEST_RUNTIME_DATABASE_URL ??
  testDatabaseUrl?.replace(
    'knot_migrator:knot_local_migrator',
    'knot_api_runtime_test:knot_local_runtime_test'
  )
const runIntegration =
  process.env.RUN_PG_INTEGRATION === '1' && testDatabaseUrl && runtimeDatabaseUrl
const describePg = runIntegration ? describe : describe.skip

describePg('prototype API with real PostgreSQL and limited runtime role', () => {
  let migratorDb: Db
  let runtimeDb: Db
  let app: ReturnType<typeof buildServer>
  let config: AppConfig
  let githubProvider: FixtureGithubProvider

  const token = 'integration-session-token'
  const token2 = 'integration-session-token-2'
  const userId = '00000000-0000-4000-8000-000000000001'
  const userId2 = '00000000-0000-4000-8000-000000000002'
  const docA = '00000000-0000-4000-8000-000000000401'
  const docB = '00000000-0000-4000-8000-000000000402'
  const docC = '00000000-0000-4000-8000-000000000403'

  beforeAll(async () => {
    if (!testDatabaseUrl?.includes('test') || !runtimeDatabaseUrl?.includes('test')) {
      throw new Error('integration databases must be disposable and contain "test" in the URL')
    }

    migratorDb = createPool(testDatabaseUrl)
    await migratorDb.query('DROP SCHEMA public CASCADE')
    await migratorDb.query('CREATE SCHEMA public')

    const previousRuntimeUser = process.env.API_RUNTIME_DB_USER
    const previousRuntimePassword = process.env.API_RUNTIME_DB_PASSWORD
    process.env.API_RUNTIME_DB_USER = 'knot_api_runtime_test'
    process.env.API_RUNTIME_DB_PASSWORD = 'knot_local_runtime_test'
    try {
      await migrate(testDatabaseUrl)
    } finally {
      restoreEnv('API_RUNTIME_DB_USER', previousRuntimeUser)
      restoreEnv('API_RUNTIME_DB_PASSWORD', previousRuntimePassword)
    }

    runtimeDb = createPool(runtimeDatabaseUrl)
    githubProvider = new FixtureGithubProvider()
    config = {
      env: 'test',
      host: '127.0.0.1',
      port: 0,
      databaseUrl: runtimeDatabaseUrl,
      migrationDatabaseUrl: testDatabaseUrl,
      storageDriver: 'local',
      localStorageRoot: await mkdtemp(join(tmpdir(), 'knot-prototype-api-')),
      authMode: 'github',
      githubClientId: 'fixture-client',
      githubClientSecret: 'fixture-secret',
      oauthCallbackUrl: 'http://127.0.0.1:4310/v1/auth/github/callback',
      desktopScheme: 'knot-prototype',
      desktopCallbackPath: '/auth/callback',
      jsonBodyLimitBytes: 32 * 1024 * 1024,
      maxUploadBytes: 256 * 1024 * 1024
    }
    app = buildServer({ config, db: runtimeDb, githubProvider })

    await seedUser(userId, '123', 'Tester', token)
    await seedUser(userId2, '456', 'Tester 2', token2)
  })

  afterAll(async () => {
    await app.close()
    await runtimeDb.end()
    await migratorDb.end()
  })

  it('runs GitHub PKCE auth with fixture provider and rejects wrong state, verifier, replay, expiry, and revoked session', async () => {
    const wrongStateCallback = await app.inject({
      method: 'GET',
      url: '/v1/auth/github/callback?code=code&state=wrong'
    })
    expect(wrongStateCallback.statusCode).toBe(401)

    const verifier = 'client-verifier-abcdefghijklmnopqrstuvwxyz0123456789'
    const attempt = await createAuthAttempt(verifier)
    const callback = await app.inject({
      method: 'GET',
      url: `/v1/auth/github/callback?code=first-code&state=${attempt.state}`
    })
    expect(callback.statusCode).toBe(302)
    expect(githubProvider.exchangeCalls).toHaveLength(1)
    expect(githubProvider.exchangeCalls[0]).toEqual(expect.objectContaining({ code: 'first-code' }))

    const callbackTicket = parseDesktopCallback(callback.headers.location)
    const wrongVerifier = await app.inject({
      method: 'POST',
      url: '/v1/auth/exchange',
      payload: {
        attemptId: callbackTicket.attemptId,
        ticket: callbackTicket.ticket,
        verifier: `${verifier}-wrong`
      }
    })
    expect(wrongVerifier.statusCode).toBe(401)
    expect(wrongVerifier.json()).toMatchObject({ code: 'PKCE_VERIFIER_INVALID' })

    const exchange = await app.inject({
      method: 'POST',
      url: '/v1/auth/exchange',
      payload: {
        attemptId: callbackTicket.attemptId,
        ticket: callbackTicket.ticket,
        verifier
      }
    })
    expect(exchange.statusCode).toBe(200)
    expect(exchange.json().user.displayName).toBe('Fixture User')

    const replay = await app.inject({
      method: 'POST',
      url: '/v1/auth/exchange',
      payload: {
        attemptId: callbackTicket.attemptId,
        ticket: callbackTicket.ticket,
        verifier
      }
    })
    expect(replay.statusCode).toBe(401)

    const sessionToken = exchange.json().session.token
    const me = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: authHeader(sessionToken)
    })
    expect(me.statusCode).toBe(200)

    const logout = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: authHeader(sessionToken)
    })
    expect(logout.statusCode).toBe(200)
    const revoked = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: authHeader(sessionToken)
    })
    expect(revoked.statusCode).toBe(401)

    const expiredVerifier = 'expired-ticket-verifier-abcdefghijklmnopqrstuvwxyz0123456789'
    const expiredTicketAttempt = await createAuthAttempt(expiredVerifier)
    const expiredTicketCallback = await app.inject({
      method: 'GET',
      url: `/v1/auth/github/callback?code=second-code&state=${expiredTicketAttempt.state}`
    })
    expect(expiredTicketCallback.statusCode).toBe(302)
    const expiredTicket = parseDesktopCallback(expiredTicketCallback.headers.location)
    await migratorDb.query(
      "UPDATE auth_attempts SET ticket_expires_at = now() - interval '1 second' WHERE id = $1",
      [expiredTicket.attemptId]
    )
    const expiredExchange = await app.inject({
      method: 'POST',
      url: '/v1/auth/exchange',
      payload: {
        attemptId: expiredTicket.attemptId,
        ticket: expiredTicket.ticket,
        verifier: expiredVerifier
      }
    })
    expect(expiredExchange.statusCode).toBe(401)

    const expiredAttemptVerifier = 'expired-attempt-verifier-abcdefghijklmnopqrstuvwxyz0123456789'
    const expiredAttempt = await createAuthAttempt(expiredAttemptVerifier)
    await migratorDb.query(
      "UPDATE auth_attempts SET expires_at = now() - interval '1 second' WHERE id = $1",
      [expiredAttempt.attemptId]
    )
    const expiredCallback = await app.inject({
      method: 'GET',
      url: `/v1/auth/github/callback?code=third-code&state=${expiredAttempt.state}`
    })
    expect(expiredCallback.statusCode).toBe(401)
  })

  it('stores A/B/C documents, then appends a second A snapshot without mutating v1', async () => {
    const r1 = '00000000-0000-4000-8000-000000000101'
    const r2 = '00000000-0000-4000-8000-000000000102'
    const transcript1 = '00000000-0000-4000-8000-000000000201'
    const analysis1 = '00000000-0000-4000-8000-000000000301'
    const transcript2 = '00000000-0000-4000-8000-000000000202'
    const analysis2 = '00000000-0000-4000-8000-000000000302'

    await putRecording(r1, '2026-09-28T01:00:00.000Z')
    await putJsonArtifact(r1, transcript1, 'transcript', transcript(['r1-u1', 'r1-u2', 'r1-u3']))
    await putJsonArtifact(r1, analysis1, 'ai_analysis', {
      schemaVersion: 1,
      topics: [
        topic(docA, 'A', ['r1-u1'], 'A 결정'),
        topic(docB, 'B', ['r1-u2'], 'B 결정'),
        topic(docC, 'C', ['r1-u3'], 'C 결정')
      ]
    })

    const publish1 = await publish(r1, analysis1)
    expect(publish1.statusCode).toBe(200)
    expect(publish1.json().documents).toHaveLength(3)
    const aV1 = await migratorDb.query<{ id: string; body: unknown }>(
      'SELECT id, body FROM document_snapshots WHERE user_id = $1 AND document_id = $2 AND version = 1',
      [userId, docA]
    )

    await putRecording(r2, '2026-09-29T01:00:00.000Z')
    await putJsonArtifact(r2, transcript2, 'transcript', transcript(['r2-u1']))
    await putJsonArtifact(r2, analysis2, 'ai_analysis', {
      schemaVersion: 1,
      topics: [
        {
          existingDocumentId: docA,
          newDocumentId: null,
          title: 'A',
          overview: 'A 재논의',
          decisions: [{ text: 'A 추가 결정', sourceUtteranceIds: ['r2-u1'] }],
          unresolved: []
        }
      ]
    })
    const publish2 = await publish(r2, analysis2)
    expect(publish2.statusCode).toBe(200)

    const documents = await app.inject({
      method: 'GET',
      url: '/v1/documents',
      headers: authHeader()
    })
    expect(documents.statusCode).toBe(200)
    expect(documents.json().documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: docA, latestVersion: 2 }),
        expect.objectContaining({ id: docB, latestVersion: 1 }),
        expect.objectContaining({ id: docC, latestVersion: 1 })
      ])
    )
    const aDetail = await app.inject({
      method: 'GET',
      url: `/v1/documents/${docA}`,
      headers: authHeader()
    })
    expect(aDetail.json().body.sections).toHaveLength(2)

    const aV1Again = await migratorDb.query<{ id: string; body: unknown }>(
      'SELECT id, body FROM document_snapshots WHERE user_id = $1 AND document_id = $2 AND version = 1',
      [userId, docA]
    )
    expect(aV1Again.rows[0]).toEqual(aV1.rows[0])
  })

  it('stores one meeting-wide summary as a JSON artifact', async () => {
    const recordingId = '00000000-0000-4000-8000-000000000111'
    const artifactId = '00000000-0000-4000-8000-000000000211'
    const summary = {
      schemaVersion: 1,
      headline: '출시 범위를 정했습니다.',
      body: '회의에서 출시 범위와 다음 확인 일정을 논의했습니다.'
    }
    await putRecording(recordingId, '2026-09-30T01:00:00.000Z')
    await putJsonArtifact(recordingId, artifactId, 'meeting_summary', summary)
    const result = await migratorDb.query<{ raw_content: unknown }>(
      'SELECT raw_content FROM artifacts WHERE user_id = $1 AND id = $2',
      [userId, artifactId]
    )
    expect(result.rows[0]?.raw_content).toEqual(summary)
  })

  it('keeps concurrent publish idempotent and rolls back invalid topic references', async () => {
    const recordingId = '00000000-0000-4000-8000-000000000601'
    const transcriptId = '00000000-0000-4000-8000-000000000602'
    const analysisId = '00000000-0000-4000-8000-000000000603'
    const documentId = '00000000-0000-4000-8000-000000000604'

    await putRecording(recordingId, '2026-10-01T01:00:00.000Z')
    await putJsonArtifact(recordingId, transcriptId, 'transcript', transcript(['c-u1']))
    await putJsonArtifact(recordingId, analysisId, 'ai_analysis', {
      schemaVersion: 1,
      topics: [topic(documentId, 'Concurrent A', ['c-u1'], '동시 결정')]
    })

    const [first, second] = await Promise.all([
      publish(recordingId, analysisId),
      publish(recordingId, analysisId)
    ])
    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    expect(first.json()).toEqual(second.json())

    expect(
      await scalar(
        'SELECT count(*)::int FROM document_contributions WHERE user_id = $1 AND document_id = $2',
        [userId, documentId]
      )
    ).toBe(1)

    const otherRecordingId = '00000000-0000-4000-8000-000000000611'
    const otherTranscriptId = '00000000-0000-4000-8000-000000000612'
    const otherAnalysisId = '00000000-0000-4000-8000-000000000613'
    const otherDocumentId = '00000000-0000-4000-8000-000000000614'
    await putRecording(otherRecordingId, '2026-10-01T02:00:00.000Z')
    await putJsonArtifact(otherRecordingId, otherTranscriptId, 'transcript', transcript(['d-u1']))
    await putJsonArtifact(otherRecordingId, otherAnalysisId, 'ai_analysis', {
      schemaVersion: 1,
      topics: [topic(otherDocumentId, 'Concurrent B', ['d-u1'], '다른 회의 결정')]
    })

    const [sameRecordingReplay, differentRecordingPublish] = await Promise.all([
      publish(recordingId, analysisId),
      publish(otherRecordingId, otherAnalysisId)
    ])
    expect(sameRecordingReplay.statusCode).toBe(200)
    expect(differentRecordingPublish.statusCode).toBe(200)

    const invalidRecordingId = '00000000-0000-4000-8000-000000000621'
    const invalidTranscriptId = '00000000-0000-4000-8000-000000000622'
    const invalidAnalysisId = '00000000-0000-4000-8000-000000000623'
    const invalidDocumentId = '00000000-0000-4000-8000-000000000624'
    await putRecording(invalidRecordingId, '2026-10-01T03:00:00.000Z')
    await putJsonArtifact(
      invalidRecordingId,
      invalidTranscriptId,
      'transcript',
      transcript(['valid-u1'])
    )
    await putJsonArtifact(invalidRecordingId, invalidAnalysisId, 'ai_analysis', {
      schemaVersion: 1,
      topics: [topic(invalidDocumentId, 'Invalid', ['missing-u2'], '롤백되어야 하는 결정')]
    })
    const invalidPublish = await publish(invalidRecordingId, invalidAnalysisId)
    expect(invalidPublish.statusCode).toBe(422)
    expect(
      await scalar('SELECT count(*)::int FROM domain_documents WHERE user_id = $1 AND id = $2', [
        userId,
        invalidDocumentId
      ])
    ).toBe(0)
    expect(
      await scalar(
        'SELECT count(*)::int FROM document_contributions WHERE user_id = $1 AND document_id = $2',
        [userId, invalidDocumentId]
      )
    ).toBe(0)
  })

  it('conceals artifacts, documents, events, and same document UUID across owners', async () => {
    const u2Recording = '00000000-0000-4000-8000-000000000501'
    const u2Transcript = '00000000-0000-4000-8000-000000000502'
    const u2Analysis = '00000000-0000-4000-8000-000000000503'

    await putRecording(u2Recording, '2026-09-30T01:00:00.000Z', token2)
    await putJsonArtifact(u2Recording, u2Transcript, 'transcript', transcript(['u2-u1']), token2)
    await putJsonArtifact(
      u2Recording,
      u2Analysis,
      'ai_analysis',
      {
        schemaVersion: 1,
        topics: [topic(docA, 'A', ['u2-u1'], 'U2 A 결정')]
      },
      token2
    )

    const publishResponse = await publish(u2Recording, u2Analysis, token2)
    expect(publishResponse.statusCode).toBe(200)

    const snapshots = await migratorDb.query<{ user_id: string; version: number }>(
      'SELECT user_id, version FROM document_snapshots WHERE document_id = $1 ORDER BY user_id, version',
      [docA]
    )
    expect(snapshots.rows).toEqual([
      { user_id: userId, version: 1 },
      { user_id: userId, version: 2 },
      { user_id: userId2, version: 1 }
    ])

    const u2OwnDoc = await app.inject({
      method: 'GET',
      url: `/v1/documents/${docA}`,
      headers: authHeader(token2)
    })
    expect(u2OwnDoc.statusCode).toBe(200)
    expect(u2OwnDoc.json().body.sections).toHaveLength(1)
    const u2CannotReadU1Recording = await app.inject({
      method: 'GET',
      url: '/v1/recordings/00000000-0000-4000-8000-000000000101',
      headers: authHeader(token2)
    })
    expect(u2CannotReadU1Recording.statusCode).toBe(404)
    const u2CannotReadU1Artifact = await app.inject({
      method: 'GET',
      url: '/v1/artifacts/00000000-0000-4000-8000-000000000201/content',
      headers: authHeader(token2)
    })
    expect(u2CannotReadU1Artifact.statusCode).toBe(404)

    const crossOwnerEvent = await app.inject({
      method: 'POST',
      url: '/v1/events/batch',
      headers: authHeader(token2),
      payload: {
        events: [
          {
            eventId: '00000000-0000-4000-8000-000000000701',
            eventType: 'document_viewed',
            occurredAt: '2026-10-01T00:00:00.000Z',
            recordingId: '00000000-0000-4000-8000-000000000101',
            documentId: docA
          }
        ]
      }
    })
    expect(crossOwnerEvent.statusCode).toBe(404)

    const ownEvent = await app.inject({
      method: 'POST',
      url: '/v1/events/batch',
      headers: authHeader(token2),
      payload: {
        events: [
          {
            eventId: '00000000-0000-4000-8000-000000000702',
            eventType: 'document_viewed',
            occurredAt: '2026-10-01T00:00:00.000Z',
            recordingId: u2Recording,
            documentId: docA
          }
        ]
      }
    })
    expect(ownEvent.statusCode).toBe(200)

    const unsafeMetadataEventId = '00000000-0000-4000-8000-000000000703'
    const unsafeMetadata = await app.inject({
      method: 'POST',
      url: '/v1/events/batch',
      headers: authHeader(token2),
      payload: {
        events: [
          {
            eventId: unsafeMetadataEventId,
            eventType: 'processing_stage_failed',
            occurredAt: '2026-10-01T00:00:00.000Z',
            recordingId: u2Recording,
            metadata: {
              stage: 'ai_analysis',
              transcript: 'must not be accepted',
              token: 'must not be accepted'
            }
          }
        ]
      }
    })
    expect(unsafeMetadata.statusCode).toBe(400)
    expect(
      await scalar('SELECT count(*)::int FROM events WHERE user_id = $1 AND id = $2', [
        userId2,
        unsafeMetadataEventId
      ])
    ).toBe(0)
  })

  it('streams WAV bytes, rejects interrupted/hash-mismatched uploads, and recovers idempotent replay', async () => {
    const recordingId = '00000000-0000-4000-8000-000000000801'
    const artifactId = '00000000-0000-4000-8000-000000000802'
    const content = Buffer.from('fixture wav bytes')
    const contentSha = sha256(content)

    await putRecording(recordingId, '2026-10-02T01:00:00.000Z')
    const metadata = await app.inject({
      method: 'PUT',
      url: `/v1/recordings/${recordingId}/artifacts/${artifactId}`,
      headers: authHeader(),
      payload: {
        kind: 'wav',
        sha256: contentSha,
        byteLength: content.byteLength
      }
    })
    expect(metadata.statusCode).toBe(200)

    const interrupted = await app.inject({
      method: 'PUT',
      url: `/v1/artifacts/${artifactId}/content`,
      headers: {
        ...authHeader(),
        'content-type': 'application/octet-stream'
      },
      payload: Readable.from(Buffer.from('short'))
    })
    expect(interrupted.statusCode).toBe(409)
    const notComplete = await app.inject({
      method: 'POST',
      url: `/v1/artifacts/${artifactId}/complete`,
      headers: authHeader()
    })
    expect(notComplete.statusCode).toBe(409)

    const upload = await app.inject({
      method: 'PUT',
      url: `/v1/artifacts/${artifactId}/content`,
      headers: {
        ...authHeader(),
        'content-type': 'application/octet-stream'
      },
      payload: Readable.from(content)
    })
    expect(upload.statusCode).toBe(200)

    const replay = await app.inject({
      method: 'PUT',
      url: `/v1/artifacts/${artifactId}/content`,
      headers: {
        ...authHeader(),
        'content-type': 'application/octet-stream'
      },
      payload: Readable.from(content)
    })
    expect(replay.statusCode).toBe(200)

    const complete = await app.inject({
      method: 'POST',
      url: `/v1/artifacts/${artifactId}/complete`,
      headers: authHeader()
    })
    expect(complete.statusCode).toBe(200)
    expect(complete.json()).toMatchObject({ completed: true, sha256: contentSha })

    const readBack = await app.inject({
      method: 'GET',
      url: `/v1/artifacts/${artifactId}/content`,
      headers: authHeader()
    })
    expect(readBack.statusCode).toBe(200)
    expect(readBack.rawPayload).toEqual(content)
  })

  it('denies runtime role UPDATE/DELETE on immutable tables', async () => {
    await expect(runtimeDb.query("UPDATE artifacts SET kind = 'ai_raw'")).rejects.toMatchObject({
      code: '42501'
    })
    await expect(runtimeDb.query('DELETE FROM document_snapshots')).rejects.toMatchObject({
      code: '42501'
    })
  })

  async function seedUser(id: string, githubId: string, displayName: string, sessionToken: string) {
    await migratorDb.query('INSERT INTO users (id, github_id, display_name) VALUES ($1, $2, $3)', [
      id,
      githubId,
      displayName
    ])
    await migratorDb.query(
      "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')",
      [id, sha256Hex(sessionToken)]
    )
  }

  async function createAuthAttempt(verifier: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/attempts',
      payload: { challenge: pkceChallenge(verifier) }
    })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    return {
      attemptId: body.attemptId as string,
      state: new URL(body.authorizeUrl).searchParams.get('state') ?? ''
    }
  }

  async function putRecording(id: string, startedAt: string, bearer = token) {
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/recordings/${id}`,
      headers: authHeader(bearer),
      payload: {
        startedAt,
        endedAt: startedAt,
        durationMs: 1000,
        title: id
      }
    })
    expect(response.statusCode).toBe(200)
  }

  async function putJsonArtifact(
    recordingId: string,
    artifactId: string,
    kind: 'transcript' | 'ai_analysis' | 'meeting_summary',
    content: unknown,
    bearer = token
  ) {
    const bytes = Buffer.from(JSON.stringify(content))
    const response = await app.inject({
      method: 'PUT',
      url: `/v1/recordings/${recordingId}/artifacts/${artifactId}`,
      headers: authHeader(bearer),
      payload: {
        kind,
        content,
        sha256: sha256(bytes),
        byteLength: bytes.byteLength,
        provider: kind === 'ai_analysis' ? 'fixture' : undefined,
        model: kind === 'ai_analysis' ? 'fixture' : undefined,
        promptVersion: kind === 'ai_analysis' ? 'v1' : undefined
      }
    })
    expect(response.statusCode).toBe(200)
  }

  async function publish(recordingId: string, analysisArtifactId: string, bearer = token) {
    return app.inject({
      method: 'POST',
      url: `/v1/recordings/${recordingId}/publish`,
      headers: authHeader(bearer),
      payload: { analysisArtifactId }
    })
  }

  async function scalar(sql: string, params: unknown[]) {
    const result = await migratorDb.query<{ count: number }>(sql, params)
    return result.rows[0].count
  }

  function authHeader(bearer = token) {
    return { authorization: `Bearer ${bearer}` }
  }
})

class FixtureGithubProvider implements GithubProvider {
  exchangeCalls: Array<{ code: string; verifier: string }> = []

  async exchangeCode(code: string, verifier: string): Promise<string> {
    this.exchangeCalls.push({ code, verifier })
    return `fixture-access-token-${code}`
  }

  async getUser(): Promise<{ id: string; login: string; name: string }> {
    return {
      id: '789',
      login: 'fixture-user',
      name: 'Fixture User'
    }
  }
}

function parseDesktopCallback(locationHeader: string | string[] | undefined) {
  if (typeof locationHeader !== 'string') {
    throw new Error('missing location header')
  }
  const location = new URL(locationHeader)
  return {
    attemptId: location.searchParams.get('attemptId') ?? '',
    ticket: location.searchParams.get('ticket') ?? ''
  }
}

function transcript(ids: string[]) {
  return {
    utterances: ids.map((id) => ({ id, text: id }))
  }
}

function topic(newDocumentId: string, title: string, sourceUtteranceIds: string[], text: string) {
  return {
    existingDocumentId: null,
    newDocumentId,
    title,
    overview: `${title} overview`,
    decisions: [{ text, sourceUtteranceIds }],
    unresolved: []
  }
}

function sha256(value: Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}
