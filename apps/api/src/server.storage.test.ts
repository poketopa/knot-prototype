import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { text } from 'node:stream/consumers'
import { describe, expect, it, vi } from 'vitest'

import type { AppConfig } from './config.js'
import { sha256Hex } from './crypto.js'
import type { Db } from './db.js'
import { ApiError } from './errors.js'
import { buildServer } from './server.js'
import { ChunkUploadStorage } from './storage/chunks.js'
import type { ArtifactStorage } from './storage/types.js'

const userId = '00000000-0000-4000-8000-000000000001'
const otherUserId = '00000000-0000-4000-8000-000000000002'
const recordingId = '00000000-0000-4000-8000-000000000101'
const artifactId = '00000000-0000-4000-8000-000000000201'
const otherArtifactId = '00000000-0000-4000-8000-000000000202'
const token = 'storage-test-token'
const otherToken = 'other-storage-test-token'

const config: AppConfig = {
  env: 'test',
  host: '127.0.0.1',
  port: 0,
  databaseUrl: 'postgres://test/test',
  migrationDatabaseUrl: 'postgres://test/test',
  storageDriver: 'local',
  localStorageRoot: '/tmp/knot-storage-test',
  authMode: 'github',
  githubClientId: 'fixture-client',
  githubClientSecret: 'fixture-secret',
  oauthCallbackUrl: 'http://127.0.0.1:4310/v1/auth/github/callback',
  desktopScheme: 'knot-prototype',
  desktopCallbackPath: '/auth/callback',
  jsonBodyLimitBytes: 32 * 1024 * 1024,
  maxUploadBytes: 256 * 1024 * 1024
}

const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')

const authHeader = (value = token) => ({ authorization: `Bearer ${value}` })

interface ArtifactFixture {
  id: string
  userId: string
  recordingId: string
  storageKey: string
  sha256: string
  byteLength: number
  uploadStatus?: string | null
}

const artifactRow = (artifact: ArtifactFixture) => ({
  id: artifact.id,
  recording_id: artifact.recordingId,
  kind: 'wav',
  raw_content: null,
  storage_key: artifact.storageKey,
  sha256: artifact.sha256,
  byte_length: artifact.byteLength,
  provider: null,
  model: null,
  prompt_version: null,
  completed_at: null,
  content_hash: 'metadata-hash',
  upload_status: artifact.uploadStatus ?? 'pending'
})

class FakeDb implements QueryOnlyDb {
  updates: Array<{ sql: string; params: unknown[] }> = []
  private readonly sessions = new Map([
    [sha256Hex(token), { id: userId, display_name: 'Tester' }],
    [sha256Hex(otherToken), { id: otherUserId, display_name: 'Other Tester' }]
  ])

  constructor(private readonly artifacts: ArtifactFixture[]) {}

  async query<T = unknown>(sql: string, params: unknown[] = []) {
    const normalized = sql.replace(/\s+/g, ' ').trim()
    if (normalized.includes('FROM sessions JOIN users')) {
      const session = this.sessions.get(String(params[0]))
      return rows<T>(session ? [session] : [])
    }
    if (
      normalized.includes('FROM artifacts a') &&
      normalized.includes('WHERE a.user_id = $1 AND a.id = $2')
    ) {
      const artifact = this.artifacts.find(
        (candidate) => candidate.userId === params[0] && candidate.id === params[1]
      )
      return rows<T>(artifact ? [artifactRow(artifact)] : [])
    }
    if (normalized.startsWith('UPDATE uploads SET status =')) {
      this.updates.push({ sql: normalized, params })
      return rows<T>([])
    }
    throw new Error(`Unexpected query: ${normalized}`)
  }
}

const rows = <T>(items: unknown[]) => ({ rowCount: items.length, rows: items as T[] })

interface QueryOnlyDb {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rowCount: number; rows: T[] }>
}

const fakeStorage = () =>
  ({
    keyFor: vi.fn(
      (ownerId: string, recId: string, artId: string) =>
        `users/${ownerId}/recordings/${recId}/artifacts/${artId}.bin`
    ),
    putStream: vi.fn(
      async (key: string, _input: Readable, expected: { sha256: string; byteLength: number }) => ({
        key,
        sha256: expected.sha256,
        byteLength: expected.byteLength,
        receipt: 'put-receipt'
      })
    ),
    verify: vi.fn(async (key: string, expected: { sha256: string; byteLength: number }) => ({
      key,
      sha256: expected.sha256,
      byteLength: expected.byteLength,
      receipt: 'verify-receipt'
    })),
    stream: vi.fn(() => Readable.from(Buffer.from('stored bytes')))
  }) satisfies ArtifactStorage

const appOf = ({
  db,
  storage,
  chunkStorage
}: {
  db: QueryOnlyDb
  storage: ArtifactStorage
  chunkStorage?: ChunkUploadStorage
}) => buildServer({ config, db: db as Db, storage, chunkStorage })

const fixtureOf = (overrides: Partial<ArtifactFixture> = {}): ArtifactFixture => {
  const content = Buffer.from('fixture wav bytes')
  return {
    id: artifactId,
    userId,
    recordingId,
    storageKey: `users/${userId}/recordings/${recordingId}/artifacts/${artifactId}.bin`,
    sha256: sha256(content),
    byteLength: content.byteLength,
    ...overrides
  }
}

describe('artifact storage injection', () => {
  it('upload storage failure prevents uploads completion update', async () => {
    const db = new FakeDb([fixtureOf()])
    const storage = fakeStorage()
    vi.mocked(storage.putStream).mockRejectedValueOnce(
      new ApiError(503, 'STORAGE_UNAVAILABLE', 'storage unavailable', true)
    )
    const app = appOf({ db, storage })

    const response = await app.inject({
      method: 'PUT',
      url: `/v1/artifacts/${artifactId}/content`,
      headers: { ...authHeader(), 'content-type': 'application/octet-stream' },
      payload: Readable.from(Buffer.from('fixture wav bytes'))
    })

    expect(response.statusCode).toBe(503)
    expect(storage.putStream).toHaveBeenCalledTimes(1)
    expect(db.updates).toHaveLength(0)
  })

  it('successful upload stores the resolved storage receipt after putStream resolves', async () => {
    const db = new FakeDb([fixtureOf()])
    const storage = fakeStorage()
    const app = appOf({ db, storage })

    const response = await app.inject({
      method: 'PUT',
      url: `/v1/artifacts/${artifactId}/content`,
      headers: { ...authHeader(), 'content-type': 'application/octet-stream' },
      payload: Readable.from(Buffer.from('fixture wav bytes'))
    })

    expect(response.statusCode).toBe(200)
    expect(storage.putStream).toHaveBeenCalledWith(
      `users/${userId}/recordings/${recordingId}/artifacts/${artifactId}.bin`,
      expect.any(Readable),
      expect.objectContaining({ sha256: fixtureOf().sha256, byteLength: fixtureOf().byteLength })
    )
    expect(db.updates).toHaveLength(1)
    expect(db.updates[0].params).toEqual([
      JSON.stringify({
        key: fixtureOf().storageKey,
        sha256: fixtureOf().sha256,
        byteLength: fixtureOf().byteLength,
        receipt: 'put-receipt'
      }),
      userId,
      artifactId
    ])
  })

  it('describes chunk upload progress and finalizes verified chunks through storage', async () => {
    const content = Buffer.from('aaaabbbbcc')
    const contentSha = sha256(content)
    const artifact = fixtureOf({ sha256: contentSha, byteLength: content.byteLength })
    const db = new FakeDb([artifact])
    const storage = fakeStorage()
    const chunkStorage = new ChunkUploadStorage('/tmp/knot-storage-test-chunks', 4)
    vi.mocked(storage.verify).mockRejectedValueOnce(
      new ApiError(409, 'ARTIFACT_CONTENT_HASH_MISMATCH', 'not stored yet')
    )
    vi.mocked(storage.putStream).mockImplementationOnce(async (key, input, expected) => {
      expect(await text(input)).toBe('aaaabbbbcc')
      return { key, ...expected }
    })
    const app = appOf({ db, storage, chunkStorage })

    const descriptor = await app.inject({
      method: 'POST',
      url: `/v1/artifacts/${artifactId}/upload`,
      headers: authHeader()
    })
    expect(descriptor.statusCode).toBe(200)
    expect(descriptor.json()).toMatchObject({
      mode: 'chunked',
      version: 1,
      chunkSize: 4,
      byteLength: content.byteLength,
      sha256: contentSha,
      chunks: []
    })

    for (let index = 0; index < 3; index += 1) {
      const chunk = content.subarray(index * 4, Math.min(index * 4 + 4, content.byteLength))
      const response = await app.inject({
        method: 'PUT',
        url: `/v1/artifacts/${artifactId}/chunks/${index}`,
        headers: {
          ...authHeader(),
          'content-type': 'application/octet-stream',
          'content-length': String(chunk.byteLength),
          'x-chunk-sha256': sha256(chunk)
        },
        payload: Readable.from(chunk)
      })
      expect(response.statusCode).toBe(200)
    }

    const complete = await app.inject({
      method: 'POST',
      url: `/v1/artifacts/${artifactId}/complete`,
      headers: authHeader()
    })

    expect(complete.statusCode).toBe(200)
    expect(storage.putStream).toHaveBeenCalledTimes(1)
    expect(db.updates).toHaveLength(1)
  })

  it('GET content awaits async storage.stream before sending bytes', async () => {
    const db = new FakeDb([fixtureOf({ uploadStatus: 'completed' })])
    const storage = fakeStorage()
    vi.mocked(storage.stream).mockResolvedValueOnce(
      Readable.from(Buffer.from('async stream bytes'))
    )
    const app = appOf({ db, storage })

    const response = await app.inject({
      method: 'GET',
      url: `/v1/artifacts/${artifactId}/content`,
      headers: authHeader()
    })

    expect(response.statusCode).toBe(200)
    expect(storage.stream).toHaveBeenCalledTimes(1)
    expect(response.body).toBe('async stream bytes')
  })

  it('unauthorized and other-owner requests cannot call storage', async () => {
    const db = new FakeDb([fixtureOf(), fixtureOf({ id: otherArtifactId, userId: otherUserId })])
    const storage = fakeStorage()
    const app = appOf({ db, storage })

    const unauthorized = await app.inject({
      method: 'PUT',
      url: `/v1/artifacts/${artifactId}/content`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Readable.from(Buffer.from('fixture wav bytes'))
    })
    const otherOwner = await app.inject({
      method: 'GET',
      url: `/v1/artifacts/${otherArtifactId}/content`,
      headers: authHeader()
    })
    const otherOwnerChunk = await app.inject({
      method: 'PUT',
      url: `/v1/artifacts/${otherArtifactId}/chunks/0`,
      headers: {
        ...authHeader(),
        'content-type': 'application/octet-stream',
        'content-length': '5',
        'x-chunk-sha256': sha256(Buffer.from('hello'))
      },
      payload: Readable.from(Buffer.from('hello'))
    })

    expect(unauthorized.statusCode).toBe(401)
    expect(otherOwner.statusCode).toBe(404)
    expect(otherOwnerChunk.statusCode).toBe(404)
    expect(storage.putStream).not.toHaveBeenCalled()
    expect(storage.verify).not.toHaveBeenCalled()
    expect(storage.stream).not.toHaveBeenCalled()
  })

  it('complete verification failure does not mark upload complete', async () => {
    const db = new FakeDb([fixtureOf({ uploadStatus: 'pending' })])
    const storage = fakeStorage()
    vi.mocked(storage.verify).mockRejectedValueOnce(
      new ApiError(409, 'STORAGE_HASH_MISMATCH', 'storage hash mismatch')
    )
    const app = appOf({ db, storage })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/artifacts/${artifactId}/complete`,
      headers: authHeader()
    })

    expect(response.statusCode).toBe(409)
    expect(storage.verify).toHaveBeenCalledTimes(1)
    expect(db.updates).toHaveLength(0)
  })
})
