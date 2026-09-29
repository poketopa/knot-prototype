import { randomUUID } from 'node:crypto'
import { createReadStream, type ReadStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { type Readable } from 'node:stream'

import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

import { ApiError } from '../errors.js'
import { LocalStorage, type StoredObject } from './local.js'

export type S3StorageConfig = {
  bucket: string
  teamPrefix: string
  region: string
  spoolRoot: string
}

export type S3StorageCommand = PutObjectCommand | HeadObjectCommand | GetObjectCommand
export type S3StorageResponse = {
  ContentLength?: number
  ChecksumSHA256?: string
  Body?: unknown
}
export type S3StorageClient = {
  send(command: S3StorageCommand): Promise<S3StorageResponse>
}

const maxConcurrentSpools = 2
const maxS3UploadBytes = 2 * 1024 ** 3
let activeSpools = 0

export class S3Storage {
  private readonly client: S3StorageClient
  private readonly spool: LocalStorage
  private readonly teamPrefix: string

  constructor(
    private readonly config: S3StorageConfig,
    client?: S3StorageClient
  ) {
    this.teamPrefix = normalizePrefix(config.teamPrefix)
    if (!this.teamPrefix) {
      throw new ApiError(400, 'STORAGE_PREFIX_INVALID', 'S3 team prefix is invalid')
    }
    if (hasUnsafeSegment(this.teamPrefix)) {
      throw new ApiError(400, 'STORAGE_PREFIX_INVALID', 'S3 team prefix is invalid')
    }
    this.client = client ?? createDefaultClient(config.region)
    this.spool = new LocalStorage(config.spoolRoot)
  }

  keyFor(userId: string, recordingId: string, artifactId: string) {
    return [
      this.teamPrefix,
      'users',
      cleanSegment(userId),
      'recordings',
      cleanSegment(recordingId),
      'artifacts',
      `${cleanSegment(artifactId)}.bin`
    ].join('/')
  }

  async putStream(
    key: string,
    input: Readable,
    expected: { sha256: string; byteLength: number }
  ): Promise<StoredObject> {
    const objectKey = this.requireScopedKey(key)
    const normalizedExpected = normalizeExpected(expected)
    const release = this.acquireSpoolSlot()
    const uploadId = randomUUID()
    const spoolDirectoryKey = ['uploads', uploadId].join('/')
    const spoolKey = [spoolDirectoryKey, 'artifact.bin'].join('/')

    try {
      const spooled = await this.spool.putStream(spoolKey, input, normalizedExpected)
      const localPath = this.spool.absolutePath(spoolKey)
      const checksum = hexSha256ToBase64(spooled.sha256)
      let body: ReadStream | null = null
      try {
        body = createReadStream(localPath)
        await this.client.send(
          new PutObjectCommand({
            Bucket: this.config.bucket,
            Key: objectKey,
            Body: body,
            ContentLength: spooled.byteLength,
            ChecksumSHA256: checksum,
            IfNoneMatch: '*',
            ServerSideEncryption: 'AES256'
          })
        )
      } catch (error) {
        return await this.handlePutError(error, objectKey, normalizedExpected)
      } finally {
        body?.destroy()
      }

      await this.verifyHead(objectKey, normalizedExpected)
      return { key: objectKey, ...normalizedExpected }
    } finally {
      try {
        await rm(this.spool.absolutePath(spoolDirectoryKey), { recursive: true, force: true })
      } finally {
        release()
      }
    }
  }

  async stream(key: string): Promise<Readable> {
    const objectKey = this.requireScopedKey(key)
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: objectKey,
          ChecksumMode: 'ENABLED'
        })
      )
      if (!isReadable(response.Body)) {
        throw new ApiError(502, 'S3_CONTENT_STREAM_INVALID', 'S3 object stream is invalid', true)
      }
      return response.Body
    } catch (error) {
      throw toStorageError(error)
    }
  }

  async verify(
    key: string,
    expected: { sha256: string; byteLength: number }
  ): Promise<StoredObject> {
    const objectKey = this.requireScopedKey(key)
    const normalizedExpected = normalizeExpected(expected)
    await this.verifyHead(objectKey, normalizedExpected)
    return { key: objectKey, ...normalizedExpected }
  }

  private async handlePutError(
    error: unknown,
    key: string,
    expected: { sha256: string; byteLength: number }
  ): Promise<StoredObject> {
    const statusCode = statusOf(error)
    if (statusCode === 412) {
      const existing = await this.headObject(key)
      if (headMatches(existing, expected)) {
        return { key, ...expected }
      }
      throw new ApiError(
        409,
        'ARTIFACT_CONTENT_CONFLICT',
        'Artifact content already exists with different bytes'
      )
    }
    if (statusCode === 409) {
      throw new ApiError(
        503,
        'S3_CONDITIONAL_WRITE_CONFLICT',
        'S3 conditional upload conflicted; retry the upload',
        true
      )
    }
    throw toStorageError(error)
  }

  private async verifyHead(key: string, expected: { sha256: string; byteLength: number }) {
    const head = await this.headObject(key)
    if (!headMatches(head, expected)) {
      throw new ApiError(
        409,
        'ARTIFACT_CONTENT_HASH_MISMATCH',
        'Stored bytes do not match artifact metadata'
      )
    }
  }

  private async headObject(key: string) {
    try {
      return await this.client.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
          ChecksumMode: 'ENABLED'
        })
      )
    } catch (error) {
      if (statusOf(error) === 404) {
        throw new ApiError(
          409,
          'ARTIFACT_CONTENT_HASH_MISMATCH',
          'Stored bytes do not match artifact metadata'
        )
      }
      throw toStorageError(error)
    }
  }

  private acquireSpoolSlot() {
    if (activeSpools >= maxConcurrentSpools) {
      throw new ApiError(
        503,
        'STORAGE_SPOOL_BUSY',
        'Temporary upload storage is busy; retry the upload',
        true
      )
    }
    activeSpools += 1
    return () => {
      activeSpools -= 1
    }
  }

  private requireScopedKey(key: string) {
    const normalized = normalizePrefix(key)
    if (!normalized || normalized !== key || hasUnsafeSegment(normalized)) {
      throw new ApiError(400, 'STORAGE_KEY_INVALID', 'Invalid storage key')
    }
    if (normalized !== this.teamPrefix && !normalized.startsWith(`${this.teamPrefix}/`)) {
      throw new ApiError(400, 'STORAGE_KEY_INVALID', 'Invalid storage key')
    }
    return normalized
  }
}

function createDefaultClient(region: string): S3StorageClient {
  const client = new S3Client({ region })
  return {
    send(command) {
      return client.send(command)
    }
  }
}

function trimSlashes(value: string) {
  return value.replace(/^\/+|\/+$/g, '')
}

function normalizePrefix(value: string) {
  return trimSlashes(value).replace(/\/+/g, '/')
}

function cleanSegment(value: string) {
  if (!value || value.includes('/') || value === '.' || value === '..') {
    throw new ApiError(400, 'STORAGE_KEY_INVALID', 'Invalid storage key')
  }
  return value
}

function hasUnsafeSegment(value: string) {
  return value.split('/').some((part) => !part || part === '.' || part === '..')
}

function normalizeExpected(expected: { sha256: string; byteLength: number }) {
  if (!Number.isSafeInteger(expected.byteLength) || expected.byteLength < 0) {
    throw new ApiError(400, 'ARTIFACT_CONTENT_METADATA_INVALID', 'Artifact byte length is invalid')
  }
  if (expected.byteLength > maxS3UploadBytes) {
    throw new ApiError(413, 'ARTIFACT_CONTENT_TOO_LARGE', 'Uploaded bytes exceed maximum size')
  }
  if (!/^[0-9a-f]{64}$/i.test(expected.sha256)) {
    throw new ApiError(400, 'ARTIFACT_CONTENT_METADATA_INVALID', 'Artifact checksum is invalid')
  }
  return { sha256: expected.sha256.toLowerCase(), byteLength: expected.byteLength }
}

function hexSha256ToBase64(value: string) {
  return Buffer.from(value, 'hex').toString('base64')
}

function headMatches(
  head: { ContentLength?: number; ChecksumSHA256?: string },
  expected: { sha256: string; byteLength: number }
) {
  return (
    head.ContentLength === expected.byteLength &&
    head.ChecksumSHA256 === hexSha256ToBase64(expected.sha256)
  )
}

function statusOf(error: unknown) {
  return typeof error === 'object' &&
    error !== null &&
    '$metadata' in error &&
    typeof error.$metadata === 'object' &&
    error.$metadata !== null &&
    'httpStatusCode' in error.$metadata
    ? error.$metadata.httpStatusCode
    : undefined
}

function toStorageError(error: unknown) {
  if (error instanceof ApiError) {
    return error
  }
  return new ApiError(503, 'S3_STORAGE_UNAVAILABLE', 'S3 storage request failed', true)
}

function isReadable(value: unknown): value is Readable {
  return (
    typeof value === 'object' &&
    value !== null &&
    'pipe' in value &&
    typeof value.pipe === 'function'
  )
}
