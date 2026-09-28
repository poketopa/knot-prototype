import type { Readable } from 'node:stream'

import type { StoredObject } from './local.js'

export type ArtifactStorage = {
  keyFor(userId: string, recordingId: string, artifactId: string): string
  putStream(
    key: string,
    input: Readable,
    expected: { sha256: string; byteLength: number }
  ): Promise<StoredObject>
  verify(key: string, expected: { sha256: string; byteLength: number }): Promise<StoredObject>
  stream(key: string): Readable | Promise<Readable>
}
