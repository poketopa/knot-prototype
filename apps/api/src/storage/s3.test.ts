import { createHash } from 'node:crypto'
import type { ReadStream } from 'node:fs'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import { text } from 'node:stream/consumers'

import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { describe, expect, it } from 'vitest'

import { S3Storage, type S3StorageClient, type S3StorageResponse } from './s3.js'

describe('S3Storage', () => {
  it('uploads a verified spooled file with immutable S3 headers and verifies the remote checksum', async () => {
    const data = Buffer.from('hello')
    const expected = expectedFor(data)
    const client = new FakeS3Client([
      { type: 'put', output: {} },
      {
        type: 'head',
        output: { ContentLength: expected.byteLength, ChecksumSHA256: sha256Base64(data) }
      }
    ])
    const storage = await createStorage(client)
    const key = storage.keyFor('user-id', 'recording-id', 'artifact-id')

    const stored = await storage.putStream(key, Readable.from(data), expected)

    expect(stored).toEqual({ key, ...expected })
    expect(client.commands).toHaveLength(2)
    const put = client.commands[0]
    expect(put).toBeInstanceOf(PutObjectCommand)
    expect(put.input).toMatchObject({
      Bucket: 'your-private-bucket',
      Key: 'knot/prototype/users/user-id/recordings/recording-id/artifacts/artifact-id.bin',
      ContentLength: data.byteLength,
      ChecksumSHA256: sha256Base64(data),
      IfNoneMatch: '*',
      ServerSideEncryption: 'AES256'
    })
    expect(client.putBodies).toEqual([data])
  })

  it('fails before S3 when uploaded bytes exceed declared metadata', async () => {
    const client = new FakeS3Client([])
    const storage = await createStorage(client)
    const key = storage.keyFor('user-id', 'recording-id', 'artifact-id')

    await expect(
      storage.putStream(
        key,
        Readable.from(Buffer.from('changed')),
        expectedFor(Buffer.from('stable'))
      )
    ).rejects.toMatchObject({ code: 'ARTIFACT_CONTENT_TOO_LARGE' })
    expect(client.commands).toHaveLength(0)
  })

  it('fails before S3 when equal-length uploaded bytes have a different hash', async () => {
    const client = new FakeS3Client([])
    const storage = await createStorage(client)
    const key = storage.keyFor('user-id', 'recording-id', 'artifact-id')

    await expect(
      storage.putStream(key, Readable.from(Buffer.from('bbb')), expectedFor(Buffer.from('aaa')))
    ).rejects.toMatchObject({ code: 'ARTIFACT_CONTENT_HASH_MISMATCH' })
    expect(client.commands).toHaveLength(0)
  })

  it('rejects keys outside the configured S3 team prefix before S3', async () => {
    const client = new FakeS3Client([])
    const storage = await createStorage(client)

    await expect(
      storage.putStream(
        'other/prototype/users/user-id/recordings/recording-id/artifacts/artifact-id.bin',
        Readable.from(Buffer.from('hello')),
        expectedFor(Buffer.from('hello'))
      )
    ).rejects.toMatchObject({ code: 'STORAGE_KEY_INVALID' })
    expect(client.commands).toHaveLength(0)
  })

  it('recovers a conditional retry when the existing remote object matches', async () => {
    const data = Buffer.from('stable')
    const expected = expectedFor(data)
    const client = new FakeS3Client([
      { type: 'put', error: s3Error(412) },
      {
        type: 'head',
        output: { ContentLength: expected.byteLength, ChecksumSHA256: sha256Base64(data) }
      }
    ])
    const storage = await createStorage(client)
    const key = storage.keyFor('user-id', 'recording-id', 'artifact-id')

    await expect(storage.putStream(key, Readable.from(data), expected)).resolves.toEqual({
      key,
      ...expected
    })
  })

  it('rejects a conditional retry when the existing remote object has different bytes', async () => {
    const data = Buffer.from('stable')
    const expected = expectedFor(data)
    const client = new FakeS3Client([
      { type: 'put', error: s3Error(412) },
      {
        type: 'head',
        output: {
          ContentLength: expected.byteLength,
          ChecksumSHA256: sha256Base64(Buffer.from('x'))
        }
      }
    ])
    const storage = await createStorage(client)
    const key = storage.keyFor('user-id', 'recording-id', 'artifact-id')

    await expect(storage.putStream(key, Readable.from(data), expected)).rejects.toMatchObject({
      code: 'ARTIFACT_CONTENT_CONFLICT'
    })
  })

  it('marks S3 conditional conflicts as retryable', async () => {
    const data = Buffer.from('stable')
    const client = new FakeS3Client([{ type: 'put', error: s3Error(409) }])
    const storage = await createStorage(client)
    const key = storage.keyFor('user-id', 'recording-id', 'artifact-id')

    await expect(
      storage.putStream(key, Readable.from(data), expectedFor(data))
    ).rejects.toMatchObject({
      statusCode: 503,
      code: 'S3_CONDITIONAL_WRITE_CONFLICT',
      retryable: true
    })
  })

  it('rejects successful puts when HeadObject reports a missing or mismatched checksum', async () => {
    const data = Buffer.from('stable')
    const expected = expectedFor(data)
    const missingHead = new FakeS3Client([
      { type: 'put', output: {} },
      { type: 'head', error: s3Error(404) }
    ])
    const missingStorage = await createStorage(missingHead)
    const missingKey = missingStorage.keyFor('user-id', 'recording-id', 'missing-artifact')

    await expect(
      missingStorage.putStream(missingKey, Readable.from(data), expected)
    ).rejects.toMatchObject({ code: 'ARTIFACT_CONTENT_HASH_MISMATCH' })

    const wrongHead = new FakeS3Client([
      { type: 'put', output: {} },
      {
        type: 'head',
        output: {
          ContentLength: expected.byteLength,
          ChecksumSHA256: sha256Base64(Buffer.from('x'))
        }
      }
    ])
    const wrongStorage = await createStorage(wrongHead)
    const wrongKey = wrongStorage.keyFor('user-id', 'recording-id', 'wrong-artifact')

    await expect(
      wrongStorage.putStream(wrongKey, Readable.from(data), expected)
    ).rejects.toMatchObject({ code: 'ARTIFACT_CONTENT_HASH_MISMATCH' })
  })

  it('destroys the spooled upload stream and cleans temporary files when S3 fails before reading', async () => {
    const data = Buffer.from('stable')
    const client = new FakeS3Client([{ type: 'put', error: s3Error(503) }])
    const { storage, spoolRoot } = await createStorageWithRoot(client)
    const key = storage.keyFor('user-id', 'recording-id', 'artifact-id')

    await expect(
      storage.putStream(key, Readable.from(data), expectedFor(data))
    ).rejects.toMatchObject({
      code: 'S3_STORAGE_UNAVAILABLE',
      retryable: true
    })

    const putBody = (client.commands[0] as PutObjectCommand).input.Body as ReadStream
    expect(putBody.destroyed).toBe(true)
    await expect(readdir(join(spoolRoot, 'uploads'))).resolves.toEqual([])
  })

  it('verifies remote length and checksum using HeadObject checksum mode', async () => {
    const data = Buffer.from('hello')
    const expected = expectedFor(data)
    const client = new FakeS3Client([
      {
        type: 'head',
        output: { ContentLength: expected.byteLength, ChecksumSHA256: sha256Base64(data) }
      }
    ])
    const storage = await createStorage(client)
    const key = storage.keyFor('user-id', 'recording-id', 'artifact-id')

    await expect(storage.verify(key, expected)).resolves.toEqual({ key, ...expected })
    expect(client.commands[0]).toBeInstanceOf(HeadObjectCommand)
    expect(client.commands[0].input).toMatchObject({ ChecksumMode: 'ENABLED' })
  })

  it('streams S3 object content through GetObject', async () => {
    const client = new FakeS3Client([
      { type: 'get', output: { Body: Readable.from(Buffer.from('hello')) } }
    ])
    const storage = await createStorage(client)
    const key = storage.keyFor('user-id', 'recording-id', 'artifact-id')

    await expect(text(await storage.stream(key))).resolves.toBe('hello')
    expect(client.commands[0]).toBeInstanceOf(GetObjectCommand)
    expect(client.commands[0].input).toMatchObject({ ChecksumMode: 'ENABLED' })
  })

  it('masks S3 read permission errors as retryable storage failures', async () => {
    const client = new FakeS3Client([{ type: 'get', error: s3Error(403) }])
    const storage = await createStorage(client)
    const key = storage.keyFor('user-id', 'recording-id', 'artifact-id')

    await expect(storage.stream(key)).rejects.toMatchObject({
      statusCode: 503,
      code: 'S3_STORAGE_UNAVAILABLE',
      retryable: true
    })
  })

  it('releases the spool slot after two stalled uploads finish', async () => {
    const firstInput = new PassThrough()
    const secondInput = new PassThrough()
    const firstClient = new FakeS3Client([])
    const secondClient = new FakeS3Client([])
    const thirdClient = new FakeS3Client([])
    const firstStorage = await createStorage(firstClient)
    const secondStorage = await createStorage(secondClient)
    const thirdStorage = await createStorage(thirdClient)
    const data = Buffer.from('hello')
    const expected = expectedFor(data)

    const firstUpload = firstStorage.putStream(
      firstStorage.keyFor('user-id', 'recording-id', 'first-artifact'),
      firstInput,
      expected
    )
    const secondUpload = secondStorage.putStream(
      secondStorage.keyFor('user-id', 'recording-id', 'second-artifact'),
      secondInput,
      expected
    )
    const firstFailure = expect(firstUpload).rejects.toMatchObject({
      code: 'S3_STORAGE_UNAVAILABLE'
    })
    const secondFailure = expect(secondUpload).rejects.toMatchObject({
      code: 'S3_STORAGE_UNAVAILABLE'
    })
    await waitForSpoolOpen()

    await expect(
      thirdStorage.putStream(
        thirdStorage.keyFor('user-id', 'recording-id', 'third-artifact'),
        Readable.from(data),
        expected
      )
    ).rejects.toMatchObject({ code: 'STORAGE_SPOOL_BUSY', retryable: true })
    expect(thirdClient.commands).toHaveLength(0)

    firstInput.end(data)
    secondInput.end(data)
    await Promise.all([firstFailure, secondFailure])

    const finalClient = new FakeS3Client([
      { type: 'put', output: {} },
      {
        type: 'head',
        output: { ContentLength: expected.byteLength, ChecksumSHA256: sha256Base64(data) }
      }
    ])
    const finalStorage = await createStorage(finalClient)
    const finalKey = finalStorage.keyFor('user-id', 'recording-id', 'final-artifact')

    await expect(finalStorage.putStream(finalKey, Readable.from(data), expected)).resolves.toEqual({
      key: finalKey,
      ...expected
    })
  })
})

type FakeStep =
  | { type: 'put'; output?: S3StorageResponse; error?: Error }
  | { type: 'head'; output?: S3StorageResponse; error?: Error }
  | { type: 'get'; output?: S3StorageResponse; error?: Error }

class FakeS3Client implements S3StorageClient {
  readonly commands: Array<PutObjectCommand | HeadObjectCommand | GetObjectCommand> = []
  readonly putBodies: Buffer[] = []

  constructor(private readonly steps: FakeStep[]) {}

  async send(
    command: PutObjectCommand | HeadObjectCommand | GetObjectCommand
  ): Promise<S3StorageResponse> {
    this.commands.push(command)
    const step = this.steps.shift()
    if (!step) {
      throw new Error('Unexpected S3 command')
    }
    if (!matchesStep(step, command)) {
      throw new Error(`Unexpected S3 command for step ${step.type}`)
    }
    if (step.error) {
      throw step.error
    }
    if (command instanceof PutObjectCommand) {
      const body = command.input.Body
      if (isReadable(body)) {
        this.putBodies.push(Buffer.from(await text(body)))
      }
    }
    return step.output ?? {}
  }
}

async function createStorage(client: S3StorageClient) {
  return (await createStorageWithRoot(client)).storage
}

async function createStorageWithRoot(client: S3StorageClient) {
  const spoolRoot = await mkdtemp(join(tmpdir(), 'knot-s3-spool-'))
  const storage = new S3Storage(
    {
      bucket: 'your-private-bucket',
      teamPrefix: '/knot/prototype/',
      region: 'ap-northeast-2',
      spoolRoot
    },
    client
  )
  return { storage, spoolRoot }
}

function expectedFor(value: Buffer) {
  return { sha256: createHash('sha256').update(value).digest('hex'), byteLength: value.byteLength }
}

function sha256Base64(value: Buffer) {
  return createHash('sha256').update(value).digest('base64')
}

function s3Error(statusCode: number) {
  return Object.assign(new Error(`S3 ${statusCode}`), {
    $metadata: { httpStatusCode: statusCode }
  })
}

function matchesStep(
  step: FakeStep,
  command: PutObjectCommand | HeadObjectCommand | GetObjectCommand
) {
  return (
    (step.type === 'put' && command instanceof PutObjectCommand) ||
    (step.type === 'head' && command instanceof HeadObjectCommand) ||
    (step.type === 'get' && command instanceof GetObjectCommand)
  )
}

function isReadable(value: unknown): value is NodeJS.ReadableStream {
  return (
    typeof value === 'object' &&
    value !== null &&
    'pipe' in value &&
    typeof value.pipe === 'function'
  )
}

async function waitForSpoolOpen() {
  await new Promise((resolve) => setImmediate(resolve))
}
