import { createHash } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { describe, expect, it } from 'vitest'

import { ApiError } from '../errors.js'
import { LocalStorage } from './local.js'

describe('LocalStorage', () => {
  it('rejects keys outside of the storage root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'knot-storage-'))
    const storage = new LocalStorage(root)

    expect(() => storage.absolutePath('../outside')).toThrow('Invalid storage key')
  })

  it('stores bytes with an exclusive final object and recovers identical retry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'knot-storage-'))
    const storage = new LocalStorage(root)
    const key = storage.keyFor('user', 'recording', 'artifact')
    const data = Buffer.from('hello')
    const expected = { sha256: sha256(data), byteLength: data.byteLength }

    await storage.putStream(key, Readable.from(data), expected)
    await storage.putStream(key, Readable.from(data), expected)

    await expect(readFile(storage.absolutePath(key), 'utf8')).resolves.toBe('hello')
  })

  it('rejects retries with different bytes before overwriting existing content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'knot-storage-'))
    const storage = new LocalStorage(root)
    const key = storage.keyFor('user', 'recording', 'artifact')
    const existing = Buffer.from('stable')
    await storage.putStream(key, Readable.from(existing), {
      sha256: sha256(existing),
      byteLength: existing.byteLength
    })

    await expect(
      storage.putStream(key, Readable.from(Buffer.from('changed')), {
        sha256: sha256(Buffer.from('changed')),
        byteLength: 7
      })
    ).rejects.toMatchObject({ code: 'ARTIFACT_CONTENT_CONFLICT' })
    await expect(readFile(storage.absolutePath(key), 'utf8')).resolves.toBe('stable')
  })

  it('aborts when uploaded bytes exceed declared byte length', async () => {
    const root = await mkdtemp(join(tmpdir(), 'knot-storage-'))
    const storage = new LocalStorage(root)
    const key = storage.keyFor('user', 'recording', 'artifact')

    await expect(
      storage.putStream(key, Readable.from(Buffer.from('too large')), {
        sha256: sha256(Buffer.from('too large')),
        byteLength: 3
      })
    ).rejects.toBeInstanceOf(ApiError)
  })

  const largeIt = process.env.RUN_LARGE_STORAGE_TEST === '1' ? it : it.skip

  largeIt('streams 200MiB without buffering the whole object in application code', async () => {
    const root = await mkdtemp(join(tmpdir(), 'knot-storage-'))
    const storage = new LocalStorage(root)
    const key = storage.keyFor('user', 'recording', 'large-artifact')
    const chunk = Buffer.alloc(1024 * 1024, 7)
    const chunks = 200
    const hash = createHash('sha256')
    for (let index = 0; index < chunks; index += 1) {
      hash.update(chunk)
    }
    const expected = {
      sha256: hash.digest('hex'),
      byteLength: chunk.byteLength * chunks
    }

    const before = process.memoryUsage().rss
    await storage.putStream(key, repeatedChunks(chunk, chunks), expected)
    const after = process.memoryUsage().rss
    const verified = await storage.verify(key, expected)

    expect(verified).toMatchObject(expected)
    expect(after - before).toBeLessThan(80 * 1024 * 1024)
  })
})

function sha256(value: Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

function repeatedChunks(chunk: Buffer, count: number) {
  let emitted = 0
  return new Readable({
    read() {
      if (emitted >= count) {
        this.push(null)
        return
      }
      emitted += 1
      this.push(chunk)
    }
  })
}
