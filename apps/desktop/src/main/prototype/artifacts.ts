import { createHash, randomUUID } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { PrototypeTranscript } from '@shared/prototype'
import type { TopicAnalysisAttempt, Utterance } from '@shared/types'
import { getDb } from '../db/connection'
import { findMeeting } from '../db/meetings'
import { listUtterances } from '../db/utterances'
import { enqueueOutbox } from './outbox'
import { prototypeUserRoot, requirePrototypeUser } from './authState'
import { prototypeRequest } from './apiClient'

export type PrototypeArtifactKind = 'wav' | 'transcript' | 'ai_raw' | 'ai_analysis' | 'ai_partial'

interface RegisterArtifactParams {
  recordingId: string
  kind: PrototypeArtifactKind
  localPath?: string
  content?: unknown
  provider?: string
  model?: string
  promptVersion?: string
}

interface RegisterSpoolArtifactParams {
  recordingId: string
  kind: PrototypeArtifactKind
  sourcePath: string
  provider?: string
  model?: string
  promptVersion?: string
}

const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')

const sha256File = (filePath: string) =>
  new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256')
    const input = createReadStream(filePath)
    input.on('data', (chunk) => hash.update(chunk))
    input.on('error', reject)
    input.on('end', () => resolve(hash.digest('hex')))
  })

const artifactDir = async ({ recordingId }: { recordingId: string }) => {
  const dir = path.join(prototypeUserRoot(), 'artifacts', recordingId)
  await mkdir(dir, { recursive: true })

  return dir
}

const byteLengthOf = async ({ localPath, content }: { localPath?: string; content?: string }) => {
  if (localPath) return (await stat(localPath)).size

  return Buffer.byteLength(content ?? '', 'utf8')
}

const hashOf = async ({ localPath, content }: { localPath?: string; content?: string }) => {
  if (localPath) return sha256File(localPath)

  return sha256(content ?? '')
}

const readJsonIfPossible = async (filePath: string) => {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as unknown
  } catch {
    return undefined
  }
}

export const registerPrototypeArtifact = async ({
  recordingId,
  kind,
  localPath,
  content,
  provider,
  model,
  promptVersion
}: RegisterArtifactParams) => {
  const owner = requirePrototypeUser()
  const textContent = content === undefined ? undefined : JSON.stringify(content)
  const artifactId = randomUUID()
  const byteLength = await byteLengthOf({ localPath, content: textContent })
  const contentHash = await hashOf({ localPath, content: textContent })
  const existing = getDb()
    .prepare(
      `SELECT id
       FROM prototype_artifacts
       WHERE owner_id = @ownerId
         AND recording_id = @recordingId
         AND kind = @kind
         AND sha256 = @sha256
       LIMIT 1`
    )
    .get({ ownerId: owner.id, recordingId, kind, sha256: contentHash }) as
    { id: string } | undefined
  if (existing) return existing.id

  const db = getDb()
  const insertArtifact = db.prepare(
    `INSERT INTO prototype_artifacts (
       id, owner_id, recording_id, kind, local_path, content_json, sha256, byte_length,
       provider, model, prompt_version, sync_status, created_at
     )
     VALUES (
       @id, @ownerId, @recordingId, @kind, @localPath, @contentJson, @sha256, @byteLength,
       @provider, @model, @promptVersion, 'pending', @createdAt
     )`
  )
  db.transaction(() => {
    insertArtifact.run({
      id: artifactId,
      ownerId: owner.id,
      recordingId,
      kind,
      localPath: localPath ?? null,
      contentJson: textContent ?? null,
      sha256: contentHash,
      byteLength,
      provider: provider ?? null,
      model: model ?? null,
      promptVersion: promptVersion ?? null,
      createdAt: Date.now()
    })

    enqueueOutbox({
      kind: 'artifact',
      payload: {
        id: artifactId,
        recordingId,
        kind,
        content: localPath ? undefined : content,
        sha256: contentHash,
        byteLength,
        provider,
        model,
        promptVersion
      },
      ownerId: owner.id
    })
    if (localPath) {
      enqueueOutbox({
        kind: 'artifact-upload',
        payload: { id: artifactId, recordingId, kind },
        ownerId: owner.id
      })
    }
  })()

  return artifactId
}

export const registerPrototypeSpoolArtifact = async ({
  recordingId,
  kind,
  sourcePath,
  provider,
  model,
  promptVersion
}: RegisterSpoolArtifactParams) => {
  const owner = requirePrototypeUser()
  const byteLength = await byteLengthOf({ localPath: sourcePath })
  const contentHash = await hashOf({ localPath: sourcePath })
  const existing = getDb()
    .prepare(
      `SELECT id
       FROM prototype_artifacts
       WHERE owner_id = @ownerId
         AND recording_id = @recordingId
         AND kind = @kind
         AND sha256 = @sha256
       LIMIT 1`
    )
    .get({ ownerId: owner.id, recordingId, kind, sha256: contentHash }) as
    { id: string } | undefined
  if (existing) return existing.id

  const dir = await artifactDir({ recordingId })
  const extension = path.extname(sourcePath) || '.bin'
  const artifactPath = path.join(dir, `${kind}-${contentHash}${extension}`)
  await copyFile(sourcePath, artifactPath, constants.COPYFILE_EXCL).catch(
    async (caught: NodeJS.ErrnoException) => {
      if (caught.code !== 'EEXIST') throw caught
    }
  )
  const text = await readFile(sourcePath, 'utf8')
  const parsedJson = sourcePath.endsWith('.json') ? await readJsonIfPossible(sourcePath) : undefined

  return registerPrototypeArtifact({
    recordingId,
    kind,
    content: {
      schemaVersion: 1,
      sourceFileName: path.basename(sourcePath),
      artifactFileName: path.basename(artifactPath),
      sourceSha256: contentHash,
      byteLength,
      text,
      ...(parsedJson === undefined ? {} : { parsedJson })
    },
    provider,
    model,
    promptVersion
  })
}

export const preserveAudioArtifact = async ({
  recordingId,
  audioPath
}: {
  recordingId: string
  audioPath: string
}) => {
  await registerPrototypeArtifact({ recordingId, kind: 'wav', localPath: audioPath })
}

export const preserveTranscriptArtifact = async ({
  recordingId,
  rawWhisperJson,
  utterances
}: {
  recordingId: string
  rawWhisperJson: unknown
  utterances: Utterance[]
}) => {
  const dir = await artifactDir({ recordingId })
  const content = {
    schemaVersion: 1,
    rawWhisperJson,
    utterances
  }
  const serialized = `${JSON.stringify(content, null, 2)}\n`
  const transcriptPath = path.join(dir, `transcript-${sha256(serialized)}.json`)

  await writeFile(transcriptPath, serialized, { flag: 'wx' }).catch(
    async (caught: NodeJS.ErrnoException) => {
      if (caught.code !== 'EEXIST') throw caught
    }
  )

  await registerPrototypeArtifact({ recordingId, kind: 'transcript', content })
}

export const preserveTopicAnalysisArtifacts = async ({
  recordingId,
  attempt
}: {
  recordingId: string
  attempt: TopicAnalysisAttempt
}) => {
  for (const raw of attempt.rawResponses) {
    await registerPrototypeArtifact({
      recordingId,
      kind: 'ai_raw',
      content: { schemaVersion: 1, attemptId: attempt.id, label: raw.label, text: raw.text },
      provider: attempt.provider,
      model: attempt.model ?? undefined,
      promptVersion: attempt.promptVersion
    })
  }

  for (const partial of attempt.partialResults) {
    await registerPrototypeArtifact({
      recordingId,
      kind: 'ai_partial',
      content: partial,
      provider: attempt.provider,
      model: attempt.model ?? undefined,
      promptVersion: attempt.promptVersion
    })
  }

  return registerPrototypeArtifact({
    recordingId,
    kind: 'ai_analysis',
    content: attempt.result,
    provider: attempt.provider,
    model: attempt.model ?? undefined,
    promptVersion: attempt.promptVersion
  })
}

const metadataFromFailure = (failureJson: unknown) => {
  if (!failureJson || typeof failureJson !== 'object') return {}

  const record = failureJson as Record<string, unknown>

  return {
    provider: typeof record.provider === 'string' ? record.provider : undefined,
    model: typeof record.model === 'string' ? record.model : undefined,
    promptVersion: typeof record.promptVersion === 'string' ? record.promptVersion : undefined
  }
}

const registerDiagnosticFiles = async ({
  recordingId,
  failureJson,
  provider,
  model,
  promptVersion
}: {
  recordingId: string
  failureJson: unknown
  provider?: string
  model?: string | null
  promptVersion?: string
}) => {
  if (!failureJson || typeof failureJson !== 'object') return 0

  const diagnostics = (failureJson as { diagnostics?: unknown }).diagnostics
  if (!diagnostics || typeof diagnostics !== 'object') return 0

  let registered = 0
  for (const key of ['stdoutPath', 'stderrPath'] as const) {
    const sourcePath = (diagnostics as Record<string, unknown>)[key]
    if (typeof sourcePath !== 'string' || !sourcePath) continue

    try {
      await registerPrototypeSpoolArtifact({
        recordingId,
        kind: 'ai_raw',
        sourcePath,
        provider,
        model: model ?? undefined,
        promptVersion
      })
      registered += 1
    } catch (caught) {
      if ((caught as NodeJS.ErrnoException).code !== 'ENOENT') throw caught
    }
  }

  return registered
}

export const preserveTopicAttemptSpoolArtifacts = async ({
  recordingId,
  attemptDir,
  provider,
  model,
  promptVersion
}: {
  recordingId: string
  attemptDir: string
  provider?: string
  model?: string | null
  promptVersion?: string
}) => {
  let registered = 0
  const names = await readdir(attemptDir).catch(() => [] as string[])
  for (const name of names) {
    const file = path.join(attemptDir, name)
    if (name.endsWith('.raw.txt') || name.endsWith('.failure.json')) {
      const failureJson = name.endsWith('.failure.json')
        ? await readJsonIfPossible(file)
        : undefined
      const failureMetadata = metadataFromFailure(failureJson)
      await registerPrototypeSpoolArtifact({
        recordingId,
        kind: 'ai_raw',
        sourcePath: file,
        provider: provider ?? failureMetadata.provider,
        model: model ?? failureMetadata.model,
        promptVersion: promptVersion ?? failureMetadata.promptVersion
      })
      registered += 1
      registered += await registerDiagnosticFiles({
        recordingId,
        failureJson,
        provider: provider ?? failureMetadata.provider,
        model: model ?? failureMetadata.model,
        promptVersion: promptVersion ?? failureMetadata.promptVersion
      })
    }
    if (name.endsWith('.partial.json')) {
      await registerPrototypeSpoolArtifact({
        recordingId,
        kind: 'ai_partial',
        sourcePath: file,
        provider,
        model: model ?? undefined,
        promptVersion
      })
      registered += 1
    }
  }

  return registered
}

const latestTopicAttemptDir = async ({ recordingId }: { recordingId: string }) => {
  const baseDir = path.join(prototypeUserRoot(), 'ai-attempts', recordingId)
  const entries = await readdir(baseDir, { withFileTypes: true }).catch(() => [])
  const dirs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('topic-'))
      .map(async (entry) => {
        const dir = path.join(baseDir, entry.name)
        const info = await stat(dir).catch(() => null)

        return info ? { dir, mtimeMs: info.mtimeMs } : null
      })
  )
  const latest = dirs
    .filter((dir): dir is { dir: string; mtimeMs: number } => dir !== null)
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0]

  return latest?.dir ?? null
}

export const recoverTopicAttemptSpoolArtifacts = async () => {
  const baseDir = path.join(prototypeUserRoot(), 'ai-attempts')
  const recordingDirs = await readdir(baseDir, { withFileTypes: true }).catch(() => [])
  let registered = 0
  for (const recordingDir of recordingDirs) {
    if (!recordingDir.isDirectory()) continue

    const attemptsDir = path.join(baseDir, recordingDir.name)
    const attemptDirs = await readdir(attemptsDir, { withFileTypes: true }).catch(() => [])
    for (const attemptDir of attemptDirs) {
      if (!attemptDir.isDirectory() || !attemptDir.name.startsWith('topic-')) continue

      registered += await preserveTopicAttemptSpoolArtifacts({
        recordingId: recordingDir.name,
        attemptDir: path.join(attemptsDir, attemptDir.name)
      })
    }
  }

  return registered
}

export const preserveAiFailureArtifact = async ({
  recordingId,
  errorMessage,
  attemptDir
}: {
  recordingId: string
  errorMessage: string
  attemptDir?: string | null
}) => {
  const dir = attemptDir ?? (await latestTopicAttemptDir({ recordingId }))
  if (dir) await preserveTopicAttemptSpoolArtifacts({ recordingId, attemptDir: dir })

  return registerPrototypeArtifact({
    recordingId,
    kind: 'ai_raw',
    content: {
      schemaVersion: 1,
      status: 'failed',
      errorMessage,
      ...(dir ? { attemptDirName: path.basename(dir) } : {})
    }
  })
}

export const recoverMissingArtifactOutbox = () => {
  const owner = requirePrototypeUser()
  const rows = getDb()
    .prepare(
      `SELECT a.id, a.recording_id, a.kind, a.local_path, a.content_json, a.sha256, a.byte_length,
              a.provider, a.model, a.prompt_version
       FROM prototype_artifacts a
       WHERE a.owner_id = @ownerId
         AND NOT EXISTS (
           SELECT 1
           FROM prototype_outbox o
           WHERE o.owner_id = a.owner_id
             AND o.kind = 'artifact'
             AND json_extract(o.payload_json, '$.id') = a.id
         )`
    )
    .all({ ownerId: owner.id }) as Array<{
    id: string
    recording_id: string
    kind: PrototypeArtifactKind
    local_path: string | null
    content_json: string | null
    sha256: string
    byte_length: number
    provider: string | null
    model: string | null
    prompt_version: string | null
  }>
  for (const row of rows) {
    enqueueOutbox({
      kind: 'artifact',
      payload: {
        id: row.id,
        recordingId: row.recording_id,
        kind: row.kind,
        content: row.local_path ? undefined : JSON.parse(row.content_json ?? 'null'),
        sha256: row.sha256,
        byteLength: row.byte_length,
        provider: row.provider ?? undefined,
        model: row.model ?? undefined,
        promptVersion: row.prompt_version ?? undefined
      },
      ownerId: owner.id
    })
  }
  const uploads = getDb()
    .prepare(
      `SELECT a.id, a.recording_id, a.kind
       FROM prototype_artifacts a
       WHERE a.owner_id = @ownerId
         AND a.local_path IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM prototype_outbox o
           WHERE o.owner_id = a.owner_id
             AND o.kind = 'artifact-upload'
             AND json_extract(o.payload_json, '$.id') = a.id
         )`
    )
    .all({ ownerId: owner.id }) as Array<{
    id: string
    recording_id: string
    kind: PrototypeArtifactKind
  }>
  for (const row of uploads) {
    enqueueOutbox({
      kind: 'artifact-upload',
      payload: { id: row.id, recordingId: row.recording_id, kind: row.kind },
      ownerId: owner.id
    })
  }
  return rows.length + uploads.length
}

export const findPrototypeArtifact = ({
  recordingId,
  kind
}: {
  recordingId: string
  kind: PrototypeArtifactKind
}) => {
  const owner = requirePrototypeUser()
  return getDb()
    .prepare(
      `SELECT id, local_path, content_json, sha256, byte_length
       FROM prototype_artifacts
       WHERE owner_id = @ownerId AND recording_id = @recordingId AND kind = @kind
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get({ ownerId: owner.id, recordingId, kind }) as
    | {
        id: string
        local_path: string | null
        content_json: string | null
        sha256: string
        byte_length: number
      }
    | undefined
}

export const artifactLocalPath = ({ artifactId }: { artifactId: string }) => {
  const owner = requirePrototypeUser()
  const row = getDb()
    .prepare(
      `SELECT local_path
       FROM prototype_artifacts
       WHERE owner_id = @ownerId AND id = @artifactId`
    )
    .get({ ownerId: owner.id, artifactId }) as { local_path: string | null } | undefined

  if (!row?.local_path) throw new Error('전송할 파일 산출물을 찾을 수 없습니다')

  return row.local_path
}

export const artifactContentStream = ({ artifactId }: { artifactId: string }) => {
  return createReadStream(artifactLocalPath({ artifactId }))
}

interface RemoteRecordingArtifact {
  id: string
  kind: string
  completed?: boolean
}

interface RemoteRecordingDetail {
  id: string
  title: string | null
  startedAt: string
  durationMs?: number
  artifacts: RemoteRecordingArtifact[]
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const assertSamePrototypeOwner = ({ ownerId }: { ownerId: string }) => {
  if (requirePrototypeUser().id !== ownerId) throw new Error('계정이 변경되었습니다')
}

const parseRemoteRecording = ({
  value,
  recordingId
}: {
  value: unknown
  recordingId: string
}): RemoteRecordingDetail => {
  if (!isObjectRecord(value)) throw new Error('서버 녹음 응답이 올바르지 않습니다')
  if (typeof value.id !== 'string' || value.id !== recordingId) {
    throw new Error('서버 녹음 응답이 올바르지 않습니다')
  }
  if (typeof value.startedAt !== 'string') throw new Error('서버 녹음 응답이 올바르지 않습니다')
  if (value.title !== null && value.title !== undefined && typeof value.title !== 'string') {
    throw new Error('서버 녹음 응답이 올바르지 않습니다')
  }
  if (!Array.isArray(value.artifacts)) throw new Error('서버 녹음 응답이 올바르지 않습니다')

  const artifacts = value.artifacts.map((artifact) => {
    if (!isObjectRecord(artifact)) throw new Error('서버 녹음 응답이 올바르지 않습니다')
    if (typeof artifact.id !== 'string' || typeof artifact.kind !== 'string') {
      throw new Error('서버 녹음 응답이 올바르지 않습니다')
    }
    if (typeof artifact.completed !== 'boolean') {
      throw new Error('서버 녹음 응답이 올바르지 않습니다')
    }
    return { id: artifact.id, kind: artifact.kind, completed: artifact.completed }
  })

  return {
    id: value.id,
    title: value.title ?? null,
    startedAt: value.startedAt,
    durationMs: typeof value.durationMs === 'number' ? value.durationMs : undefined,
    artifacts
  }
}

const parseRemoteUtterances = ({
  content,
  recordingId
}: {
  content: unknown
  recordingId: string
}): Utterance[] => {
  if (!isObjectRecord(content) || !Array.isArray(content.utterances)) {
    throw new Error('서버 전사 산출물이 올바르지 않습니다')
  }

  return content.utterances.map((utterance, index): Utterance => {
    if (!isObjectRecord(utterance)) throw new Error('서버 전사 산출물이 올바르지 않습니다')
    if (typeof utterance.id !== 'string') throw new Error('서버 전사 산출물이 올바르지 않습니다')
    if (typeof utterance.text !== 'string') throw new Error('서버 전사 산출물이 올바르지 않습니다')
    if (typeof utterance.speakerLabel !== 'string') {
      throw new Error('서버 전사 산출물이 올바르지 않습니다')
    }
    if (typeof utterance.startSec !== 'number' || typeof utterance.endSec !== 'number') {
      throw new Error('서버 전사 산출물이 올바르지 않습니다')
    }
    if (
      !Number.isFinite(utterance.startSec) ||
      !Number.isFinite(utterance.endSec) ||
      utterance.startSec < 0 ||
      utterance.endSec < utterance.startSec
    ) {
      throw new Error('서버 전사 산출물이 올바르지 않습니다')
    }

    return {
      id: utterance.id,
      meetingId: typeof utterance.meetingId === 'string' ? utterance.meetingId : recordingId,
      ord: typeof utterance.ord === 'number' ? utterance.ord : index,
      speakerLabel: utterance.speakerLabel,
      startSec: utterance.startSec,
      endSec: utterance.endSec,
      text: utterance.text
    }
  })
}

const readRemotePrototypeTranscript = async ({
  recordingId,
  ownerId
}: {
  recordingId: string
  ownerId: string
}): Promise<PrototypeTranscript | null> => {
  const recording = parseRemoteRecording({
    value: await prototypeRequest<unknown>({ path: `/recordings/${recordingId}` }),
    recordingId
  })
  assertSamePrototypeOwner({ ownerId })

  const transcriptArtifact = recording.artifacts
    .filter((artifact) => artifact.kind === 'transcript' && artifact.completed === true)
    .at(-1)
  if (!transcriptArtifact) return null

  const content = await prototypeRequest<unknown>({
    path: `/artifacts/${transcriptArtifact.id}/content`
  })
  assertSamePrototypeOwner({ ownerId })

  return {
    recordingId: recording.id,
    title: recording.title ?? '회의 녹음',
    startedAt: recording.startedAt,
    ...(typeof recording.durationMs === 'number'
      ? { durationSec: recording.durationMs / 1000 }
      : {}),
    utterances: parseRemoteUtterances({ content, recordingId: recording.id })
  }
}

export const readPrototypeTranscript = async ({
  recordingId
}: {
  recordingId: string
}): Promise<PrototypeTranscript | null> => {
  const owner = requirePrototypeUser()
  const meeting = findMeeting({ meetingId: recordingId })
  if (!meeting) return readRemotePrototypeTranscript({ recordingId, ownerId: owner.id })

  const response: PrototypeTranscript = {
    recordingId,
    title: meeting.title,
    startedAt: new Date(meeting.createdAt).toISOString(),
    durationSec: meeting.durationSec,
    utterances: listUtterances({ meetingId: recordingId })
  }

  return response
}
