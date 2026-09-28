import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { link, mkdir, open, rm, stat, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { ApiError } from '../errors.js'

export type StoredObject = {
  key: string
  sha256: string
  byteLength: number
}

export class LocalStorage {
  constructor(private readonly root: string) {}

  keyFor(userId: string, recordingId: string, artifactId: string) {
    return join(userId, recordingId, `${artifactId}.bin`)
  }

  absolutePath(key: string) {
    const root = resolve(this.root)
    const normalized = resolve(root, key)
    const rel = relative(root, normalized)
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || rel === '') {
      throw new ApiError(400, 'STORAGE_KEY_INVALID', 'Invalid storage key')
    }
    return normalized
  }

  async putStream(
    key: string,
    input: Readable,
    expected: { sha256: string; byteLength: number }
  ): Promise<StoredObject> {
    const finalPath = this.absolutePath(key)
    const tempPath = `${finalPath}.${randomUUID()}.tmp`
    await mkdir(dirname(finalPath), { recursive: true })

    const existing = await existingObject(finalPath, key)
    if (
      existing &&
      existing.sha256 === expected.sha256 &&
      existing.byteLength === expected.byteLength
    ) {
      await drain(input)
      return existing
    }
    if (existing) {
      throw new ApiError(
        409,
        'ARTIFACT_CONTENT_CONFLICT',
        'Artifact content already exists with different bytes'
      )
    }

    const hash = createHash('sha256')
    let byteLength = 0

    try {
      const output = createWriteStream(tempPath, { flags: 'wx' })
      const verifier = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          byteLength += chunk.byteLength
          if (byteLength > expected.byteLength) {
            callback(
              new ApiError(
                413,
                'ARTIFACT_CONTENT_TOO_LARGE',
                'Uploaded bytes exceed declared artifact size'
              )
            )
            return
          }
          hash.update(chunk)
          callback(null, chunk)
        }
      })
      await pipeline(input, verifier, output)

      const sha256 = hash.digest('hex')
      if (sha256 !== expected.sha256 || byteLength !== expected.byteLength) {
        throw new ApiError(
          409,
          'ARTIFACT_CONTENT_HASH_MISMATCH',
          'Uploaded bytes do not match artifact metadata'
        )
      }

      const handle = await open(tempPath, 'r')
      try {
        await handle.sync()
      } finally {
        await handle.close()
      }
      await link(tempPath, finalPath)
      await unlink(tempPath)
      return { key, sha256, byteLength }
    } catch (error) {
      if (isFileExists(error)) {
        const recovered = await existingObject(finalPath, key)
        if (recovered?.sha256 === expected.sha256 && recovered.byteLength === expected.byteLength) {
          await rm(tempPath, { force: true })
          return recovered
        }
      }
      await rm(tempPath, { force: true })
      throw error
    }
  }

  stream(key: string) {
    return createReadStream(this.absolutePath(key))
  }

  async stat(key: string) {
    return stat(this.absolutePath(key))
  }

  async verify(
    key: string,
    expected: { sha256: string; byteLength: number }
  ): Promise<StoredObject> {
    const object = await existingObject(this.absolutePath(key), key)
    if (!object || object.sha256 !== expected.sha256 || object.byteLength !== expected.byteLength) {
      throw new ApiError(
        409,
        'ARTIFACT_CONTENT_HASH_MISMATCH',
        'Stored bytes do not match artifact metadata'
      )
    }
    return object
  }
}

async function existingObject(path: string, key: string): Promise<StoredObject | null> {
  try {
    const file = await stat(path)
    const hash = createHash('sha256')
    await new Promise<void>((resolve, reject) => {
      const input = createReadStream(path)
      input.on('data', (chunk) => hash.update(chunk))
      input.on('error', reject)
      input.on('end', resolve)
    })
    return { key, sha256: hash.digest('hex'), byteLength: file.size }
  } catch (error) {
    if (isMissingFile(error)) {
      return null
    }
    throw error
  }
}

function isMissingFile(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function isFileExists(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
}

async function drain(input: Readable) {
  input.resume()
  await new Promise<void>((resolve, reject) => {
    input.on('end', resolve)
    input.on('error', reject)
  })
}
