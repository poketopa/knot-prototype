import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  link,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Readable, Transform, type Readable as ReadableType } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { ApiError } from '../errors.js'

export const chunkUploadVersion = 1
export const defaultChunkSizeBytes = 8 * 1024 * 1024

type ExpectedArtifact = {
  sha256: string
  byteLength: number
}

type ChunkRecord = {
  index: number
  sha256: string
  byteLength: number
}

type ChunkScope = {
  userId: string
  artifactId: string
}

let activeFinalizations = 0
const activeArtifacts = new Set<string>()
const activeChunkWrites = new Set<string>()
const maxConcurrentFinalizations = 2
const maxConcurrentChunkWrites = 8

export class ChunkUploadStorage {
  constructor(
    private readonly root: string,
    private readonly chunkSize = defaultChunkSizeBytes
  ) {}

  async descriptor(scope: ChunkScope, expected: ExpectedArtifact, completed: boolean) {
    return {
      mode: 'chunked' as const,
      version: chunkUploadVersion,
      method: 'PUT' as const,
      url: `/v1/artifacts/${scope.artifactId}/content`,
      chunkUrlTemplate: `/v1/artifacts/${scope.artifactId}/chunks/{index}`,
      progressUrl: `/v1/artifacts/${scope.artifactId}/upload`,
      completeUrl: `/v1/artifacts/${scope.artifactId}/complete`,
      chunkSize: this.chunkSize,
      byteLength: expected.byteLength,
      sha256: expected.sha256,
      completed,
      chunks: completed ? [] : await this.readVerifiedChunks(scope)
    }
  }

  async putChunk({
    scope,
    index,
    input,
    expectedSha256,
    expectedByteLength,
    artifact
  }: {
    scope: ChunkScope
    index: number
    input: ReadableType
    expectedSha256: string
    expectedByteLength: number
    artifact: ExpectedArtifact
  }) {
    this.assertChunkBounds(index, expectedByteLength, artifact)
    assertSha256(expectedSha256)
    const release = this.acquireChunkWrite(scope, index)
    let tempPath: string | null = null
    try {
      const directory = this.artifactDirectory(scope)
      await mkdir(directory, { recursive: true })
      const chunkPath = this.chunkPath(scope, index)
      const metaPath = this.metaPath(scope, index)
      const existing = await this.readVerifiedChunk(scope, index)
      if (existing) {
        if (existing.sha256 === expectedSha256 && existing.byteLength === expectedByteLength) {
          await drain(input)
          return existing
        }
        throw new ApiError(
          409,
          'ARTIFACT_CHUNK_CONFLICT',
          'Chunk already exists with different bytes'
        )
      }

      tempPath = `${chunkPath}.${randomUUID()}.tmp`
      const hash = createHash('sha256')
      const chunkSize = this.chunkSize
      let byteLength = 0
      const output = createWriteStream(tempPath, { flags: 'wx' })
      const verifier = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          byteLength += chunk.byteLength
          if (byteLength > expectedByteLength || byteLength > chunkSize) {
            callback(
              new ApiError(413, 'ARTIFACT_CHUNK_TOO_LARGE', 'Uploaded chunk exceeds declared size')
            )
            return
          }
          hash.update(chunk)
          callback(null, chunk)
        }
      })
      await pipeline(input, verifier, output)
      const sha256 = hash.digest('hex')
      if (byteLength !== expectedByteLength || sha256 !== expectedSha256) {
        throw new ApiError(
          409,
          'ARTIFACT_CHUNK_HASH_MISMATCH',
          'Chunk metadata does not match bytes'
        )
      }
      await fsyncFile(tempPath)
      await link(tempPath, chunkPath)
      await unlink(tempPath)
      tempPath = null
      const record = { index, sha256, byteLength }
      await writeJsonAtomic(metaPath, record)
      return record
    } catch (error) {
      if (isFileExists(error)) {
        const recovered = await this.readVerifiedChunk(scope, index)
        if (recovered?.sha256 === expectedSha256 && recovered.byteLength === expectedByteLength) {
          return recovered
        }
        const fileOnly = await this.readChunkFile(scope, index)
        if (fileOnly?.sha256 === expectedSha256 && fileOnly.byteLength === expectedByteLength) {
          const record = { index, sha256: expectedSha256, byteLength: expectedByteLength }
          await writeJsonAtomic(this.metaPath(scope, index), record)
          return record
        }
        throw new ApiError(
          409,
          'ARTIFACT_CHUNK_CONFLICT',
          'Chunk already exists with different bytes'
        )
      }
      throw error
    } finally {
      if (tempPath) await rm(tempPath, { force: true })
      release()
    }
  }

  async finalize<T>({
    scope,
    expected,
    put
  }: {
    scope: ChunkScope
    expected: ExpectedArtifact
    put: (input: ReadableType) => Promise<T>
  }) {
    const release = this.acquireFinalization(scope)
    try {
      const chunks = await this.readVerifiedChunks(scope)
      const required = this.requiredChunkCount(expected.byteLength)
      if (chunks.length !== required || chunks.some((chunk, index) => chunk.index !== index)) {
        throw new ApiError(409, 'ARTIFACT_CHUNKS_INCOMPLETE', 'Artifact chunks are incomplete')
      }
      const byteLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
      if (byteLength !== expected.byteLength) {
        throw new ApiError(409, 'ARTIFACT_CHUNKS_INCOMPLETE', 'Artifact chunks are incomplete')
      }
      const uploaded = await put(this.streamChunks(scope, chunks))
      await rm(this.artifactDirectory(scope), { recursive: true, force: true })
      return uploaded
    } finally {
      release()
    }
  }

  async progress(scope: ChunkScope, completed: boolean) {
    return {
      completed,
      chunkSize: this.chunkSize,
      chunks: completed ? [] : await this.readVerifiedChunks(scope)
    }
  }

  private streamChunks(scope: ChunkScope, chunks: ChunkRecord[]) {
    const paths = chunks.map((chunk) => this.chunkPath(scope, chunk.index))
    return Readable.from(
      (async function* () {
        for (const filePath of paths) {
          const input = createReadStream(filePath)
          for await (const part of input) {
            yield part
          }
        }
      })()
    )
  }

  private async readVerifiedChunks(scope: ChunkScope) {
    const directory = this.artifactDirectory(scope)
    let names: string[]
    try {
      names = await readdir(directory)
    } catch (error) {
      if (isMissingFile(error)) return []
      throw error
    }
    const chunks = await Promise.all(
      names
        .filter((name) => name.endsWith('.json'))
        .map((name) => this.readVerifiedChunk(scope, Number(name.slice(0, -'.json'.length))))
    )
    return chunks
      .filter((chunk): chunk is ChunkRecord => chunk !== null)
      .sort((a, b) => a.index - b.index)
  }

  private async readVerifiedChunk(scope: ChunkScope, index: number): Promise<ChunkRecord | null> {
    if (!Number.isInteger(index) || index < 0) return null
    try {
      const raw = JSON.parse(await readFile(this.metaPath(scope, index), 'utf8')) as ChunkRecord
      if (raw.index !== index || !Number.isSafeInteger(raw.byteLength) || raw.byteLength <= 0) {
        return null
      }
      const path = this.chunkPath(scope, index)
      const file = await stat(path)
      if (file.size !== raw.byteLength) {
        await rm(path, { force: true })
        await rm(this.metaPath(scope, index), { force: true })
        return null
      }
      const actualSha256 = await sha256File(path)
      if (actualSha256 !== raw.sha256) {
        await rm(path, { force: true })
        await rm(this.metaPath(scope, index), { force: true })
        return null
      }
      return raw
    } catch (error) {
      if (isMissingFile(error)) return null
      throw error
    }
  }

  private async readChunkFile(
    scope: ChunkScope,
    index: number
  ): Promise<{ sha256: string; byteLength: number } | null> {
    try {
      const path = this.chunkPath(scope, index)
      const file = await stat(path)
      return { sha256: await sha256File(path), byteLength: file.size }
    } catch (error) {
      if (isMissingFile(error)) return null
      throw error
    }
  }

  private assertChunkBounds(index: number, expectedByteLength: number, artifact: ExpectedArtifact) {
    if (!Number.isInteger(index) || index < 0) {
      throw new ApiError(400, 'ARTIFACT_CHUNK_INDEX_INVALID', 'Chunk index is invalid')
    }
    if (!Number.isSafeInteger(expectedByteLength) || expectedByteLength <= 0) {
      throw new ApiError(400, 'ARTIFACT_CHUNK_LENGTH_INVALID', 'Chunk length is invalid')
    }
    if (expectedByteLength > this.chunkSize) {
      throw new ApiError(413, 'ARTIFACT_CHUNK_TOO_LARGE', 'Uploaded chunk exceeds maximum size')
    }
    const required = this.requiredChunkCount(artifact.byteLength)
    if (index >= required) {
      throw new ApiError(400, 'ARTIFACT_CHUNK_INDEX_INVALID', 'Chunk index is invalid')
    }
    const expectedForIndex =
      index === required - 1 ? artifact.byteLength - this.chunkSize * index : this.chunkSize
    if (expectedByteLength !== expectedForIndex) {
      throw new ApiError(409, 'ARTIFACT_CHUNK_LENGTH_MISMATCH', 'Chunk length is invalid')
    }
  }

  private requiredChunkCount(byteLength: number) {
    return Math.max(1, Math.ceil(byteLength / this.chunkSize))
  }

  private acquireFinalization(scope: ChunkScope) {
    const key = `${scope.userId}/${scope.artifactId}`
    if (activeArtifacts.has(key)) {
      throw new ApiError(
        409,
        'ARTIFACT_FINALIZE_IN_PROGRESS',
        'Artifact upload is already finalizing',
        true
      )
    }
    for (const chunkKey of activeChunkWrites) {
      if (chunkKey.startsWith(`${key}/`)) {
        throw new ApiError(
          409,
          'ARTIFACT_CHUNK_WRITE_IN_PROGRESS',
          'Artifact chunk is still uploading',
          true
        )
      }
    }
    if (activeFinalizations >= maxConcurrentFinalizations) {
      throw new ApiError(
        503,
        'ARTIFACT_FINALIZE_BUSY',
        'Upload finalization is busy; retry later',
        true
      )
    }
    activeArtifacts.add(key)
    activeFinalizations += 1
    return () => {
      activeFinalizations -= 1
      activeArtifacts.delete(key)
    }
  }

  private acquireChunkWrite(scope: ChunkScope, index: number) {
    const artifactKey = `${scope.userId}/${scope.artifactId}`
    if (activeArtifacts.has(artifactKey)) {
      throw new ApiError(
        409,
        'ARTIFACT_FINALIZE_IN_PROGRESS',
        'Artifact upload is already finalizing',
        true
      )
    }
    if (activeChunkWrites.size >= maxConcurrentChunkWrites) {
      throw new ApiError(
        503,
        'ARTIFACT_CHUNK_UPLOAD_BUSY',
        'Chunk upload is busy; retry later',
        true
      )
    }
    const key = `${artifactKey}/${index}`
    if (activeChunkWrites.has(key)) {
      throw new ApiError(
        409,
        'ARTIFACT_CHUNK_WRITE_IN_PROGRESS',
        'Chunk upload is already in progress',
        true
      )
    }
    activeChunkWrites.add(key)
    return () => activeChunkWrites.delete(key)
  }

  private artifactDirectory(scope: ChunkScope) {
    return safePath(this.root, scope.userId, scope.artifactId)
  }

  private chunkPath(scope: ChunkScope, index: number) {
    return join(this.artifactDirectory(scope), `${index}.part`)
  }

  private metaPath(scope: ChunkScope, index: number) {
    return join(this.artifactDirectory(scope), `${index}.json`)
  }
}

function safePath(root: string, userId: string, artifactId: string) {
  const absoluteRoot = resolve(root)
  const path = resolve(absoluteRoot, 'users', userId, 'artifacts', artifactId)
  const rel = relative(absoluteRoot, path)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || rel === '') {
    throw new ApiError(400, 'ARTIFACT_CHUNK_SCOPE_INVALID', 'Chunk scope is invalid')
  }
  return path
}

function assertSha256(value: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new ApiError(400, 'ARTIFACT_CHUNK_SHA256_INVALID', 'Chunk checksum is invalid')
  }
}

async function writeJsonAtomic(path: string, value: ChunkRecord) {
  const tempPath = `${path}.${randomUUID()}.tmp`
  await mkdir(dirname(path), { recursive: true })
  await writeFile(tempPath, `${JSON.stringify(value)}\n`, { flag: 'wx' })
  await fsyncFile(tempPath)
  await rename(tempPath, path)
}

async function fsyncFile(path: string) {
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function drain(input: ReadableType) {
  input.resume()
  await new Promise<void>((resolve, reject) => {
    input.on('end', resolve)
    input.on('error', reject)
  })
}

function isMissingFile(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function isFileExists(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
}

function sha256File(path: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256')
    const input = createReadStream(path)
    input.on('data', (chunk) => hash.update(chunk))
    input.on('error', reject)
    input.on('end', () => resolve(hash.digest('hex')))
  })
}
