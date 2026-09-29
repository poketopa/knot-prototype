import { createHash } from 'node:crypto'
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { text } from 'node:stream/consumers'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ChunkUploadStorage } from './chunks.js'

const userId = '00000000-0000-4000-8000-000000000001'
const otherUserId = '00000000-0000-4000-8000-000000000002'
const artifactId = '00000000-0000-4000-8000-000000000201'

const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')

describe('ChunkUploadStorage', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'knot-chunk-upload-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('persists chunk progress across storage instances and finalizes in index order', async () => {
    const storage = new ChunkUploadStorage(root, 4)
    const content = Buffer.from('aaabbbccc')
    const scope = { userId, artifactId }
    await storage.putChunk({
      scope,
      index: 1,
      input: Readable.from(content.subarray(4, 8)),
      expectedSha256: sha256(content.subarray(4, 8)),
      expectedByteLength: 4,
      artifact: { sha256: sha256(content), byteLength: content.byteLength }
    })

    const restarted = new ChunkUploadStorage(root, 4)
    await expect(restarted.progress(scope, false)).resolves.toMatchObject({
      chunks: [{ index: 1, sha256: sha256(content.subarray(4, 8)), byteLength: 4 }]
    })
    for (const [index, chunk] of [content.subarray(0, 4), content.subarray(8)].entries()) {
      await restarted.putChunk({
        scope,
        index: index === 0 ? 0 : 2,
        input: Readable.from(chunk),
        expectedSha256: sha256(chunk),
        expectedByteLength: chunk.byteLength,
        artifact: { sha256: sha256(content), byteLength: content.byteLength }
      })
    }

    const result = await restarted.finalize({
      scope,
      expected: { sha256: sha256(content), byteLength: content.byteLength },
      put: async (input) => text(input)
    })

    expect(result).toBe('aaabbbccc')
    await expect(restarted.progress(scope, false)).resolves.toMatchObject({ chunks: [] })
  })

  it('rejects missing chunks and hash conflicts without overwriting verified bytes', async () => {
    const storage = new ChunkUploadStorage(root, 4)
    const content = Buffer.from('aaaabbbb')
    const scope = { userId, artifactId }
    await storage.putChunk({
      scope,
      index: 0,
      input: Readable.from(content.subarray(0, 4)),
      expectedSha256: sha256(content.subarray(0, 4)),
      expectedByteLength: 4,
      artifact: { sha256: sha256(content), byteLength: content.byteLength }
    })

    await expect(
      storage.putChunk({
        scope,
        index: 0,
        input: Readable.from(Buffer.from('zzzz')),
        expectedSha256: sha256(Buffer.from('zzzz')),
        expectedByteLength: 4,
        artifact: { sha256: sha256(content), byteLength: content.byteLength }
      })
    ).rejects.toMatchObject({ code: 'ARTIFACT_CHUNK_CONFLICT' })
    await expect(
      storage.finalize({
        scope,
        expected: { sha256: sha256(content), byteLength: content.byteLength },
        put: async (input) => text(input)
      })
    ).rejects.toMatchObject({ code: 'ARTIFACT_CHUNKS_INCOMPLETE' })
  })

  it('keeps user scopes separate for the same artifact id', async () => {
    const storage = new ChunkUploadStorage(root, 4)
    const content = Buffer.from('aaaa')
    await storage.putChunk({
      scope: { userId, artifactId },
      index: 0,
      input: Readable.from(content),
      expectedSha256: sha256(content),
      expectedByteLength: content.byteLength,
      artifact: { sha256: sha256(content), byteLength: content.byteLength }
    })

    await expect(storage.progress({ userId: otherUserId, artifactId }, false)).resolves.toEqual({
      completed: false,
      chunkSize: 4,
      chunks: []
    })
  })

  it('drops same-size corrupted chunks from resume progress and allows repair', async () => {
    const storage = new ChunkUploadStorage(root, 4)
    const content = Buffer.from('aaaa')
    const scope = { userId, artifactId }
    await storage.putChunk({
      scope,
      index: 0,
      input: Readable.from(content),
      expectedSha256: sha256(content),
      expectedByteLength: content.byteLength,
      artifact: { sha256: sha256(content), byteLength: content.byteLength }
    })
    await writeFile(join(root, 'users', userId, 'artifacts', artifactId, '0.part'), 'zzzz')

    await expect(storage.progress(scope, false)).resolves.toEqual({
      completed: false,
      chunkSize: 4,
      chunks: []
    })
    await expect(
      storage.putChunk({
        scope,
        index: 0,
        input: Readable.from(content),
        expectedSha256: sha256(content),
        expectedByteLength: content.byteLength,
        artifact: { sha256: sha256(content), byteLength: content.byteLength }
      })
    ).resolves.toMatchObject({ index: 0, sha256: sha256(content), byteLength: 4 })
  })

  it('repairs a verified part file left without metadata after a crash', async () => {
    const storage = new ChunkUploadStorage(root, 4)
    const content = Buffer.from('aaaa')
    const scope = { userId, artifactId }
    await storage.putChunk({
      scope,
      index: 0,
      input: Readable.from(content),
      expectedSha256: sha256(content),
      expectedByteLength: content.byteLength,
      artifact: { sha256: sha256(content), byteLength: content.byteLength }
    })
    await unlink(join(root, 'users', userId, 'artifacts', artifactId, '0.json'))

    await expect(
      storage.putChunk({
        scope,
        index: 0,
        input: Readable.from(content),
        expectedSha256: sha256(content),
        expectedByteLength: content.byteLength,
        artifact: { sha256: sha256(content), byteLength: content.byteLength }
      })
    ).resolves.toMatchObject({ index: 0, sha256: sha256(content), byteLength: 4 })
    await expect(storage.progress(scope, false)).resolves.toMatchObject({
      chunks: [{ index: 0, sha256: sha256(content), byteLength: 4 }]
    })
  })

  it('rejects chunks larger than the configured chunk size before finalization', async () => {
    const storage = new ChunkUploadStorage(root, 4)
    const content = Buffer.alloc(5, 1)
    await expect(
      storage.putChunk({
        scope: { userId, artifactId },
        index: 0,
        input: Readable.from(content),
        expectedSha256: sha256(content),
        expectedByteLength: content.byteLength,
        artifact: { sha256: sha256(content), byteLength: content.byteLength }
      })
    ).rejects.toMatchObject({ code: 'ARTIFACT_CHUNK_TOO_LARGE' })
  })
})
