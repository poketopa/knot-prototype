import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userDataDir: string
const state = vi.hoisted(() => ({ owner: 'owner-1', request: vi.fn() }))

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir
  },
  BrowserWindow: {
    getAllWindows: () => []
  }
}))

vi.mock('./authState', () => ({
  requirePrototypeUser: () => ({ id: state.owner, displayName: 'Owner' }),
  prototypeUserRoot: () => path.join(userDataDir, 'prototype', 'users', state.owner)
}))

vi.mock('./apiClient', () => ({
  prototypeRequest: state.request
}))

const userRoot = () => path.join(userDataDir, 'prototype', 'users', 'owner-1')

describe('prototype artifacts', () => {
  beforeEach(async () => {
    vi.resetModules()
    state.owner = 'owner-1'
    state.request.mockReset()
    userDataDir = await mkdtemp(path.join(os.tmpdir(), 'meeting-stt-prototype-artifacts-'))
  })

  afterEach(async () => {
    const { closeDb } = await import('../db/connection')
    closeDb()
    await rm(userDataDir, { recursive: true, force: true })
  })

  it('registers failed topic attempt raw, partial, stdout, and stderr files without upload outbox', async () => {
    const attemptDir = path.join(userRoot(), 'ai-attempts', 'meeting-raw', 'topic-attempt-1')
    await mkdir(attemptDir, { recursive: true })
    const stdoutPath = path.join(attemptDir, 'llm.stdout.txt')
    const stderrPath = path.join(attemptDir, 'llm.stderr.txt')
    await writeFile(path.join(attemptDir, 'topic-whole.raw.txt'), '{ invalid model json', 'utf8')
    await writeFile(
      path.join(attemptDir, 'topic-chunk-0.partial.json'),
      '{"schemaVersion":1,"topics":[]}',
      'utf8'
    )
    await writeFile(stdoutPath, 'stdout details', 'utf8')
    await writeFile(stderrPath, 'stderr details', 'utf8')
    await writeFile(
      path.join(attemptDir, 'topic-whole.failure.json'),
      `${JSON.stringify(
        {
          label: 'topic-whole',
          provider: 'codex',
          model: 'gpt-test',
          promptVersion: 'topic-analysis-v1',
          error: 'parse failed',
          diagnostics: { stdoutPath, stderrPath }
        },
        null,
        2
      )}\n`,
      'utf8'
    )

    const { getDb } = await import('../db/connection')
    const { preserveTopicAttemptSpoolArtifacts } = await import('./artifacts')
    await expect(
      preserveTopicAttemptSpoolArtifacts({ recordingId: 'meeting-raw', attemptDir })
    ).resolves.toBe(5)

    const db = getDb()
    const artifacts = db
      .prepare('SELECT kind, content_json FROM prototype_artifacts ORDER BY created_at, kind')
      .all() as Array<{ kind: string; content_json: string }>
    const content = artifacts.map((row) => row.content_json).join('\n')
    expect(artifacts.filter((row) => row.kind === 'ai_raw')).toHaveLength(4)
    expect(artifacts.filter((row) => row.kind === 'ai_partial')).toHaveLength(1)
    expect(content).toContain('{ invalid model json')
    expect(content).toContain('stdout details')
    expect(content).toContain('stderr details')

    const outboxKinds = db
      .prepare('SELECT kind FROM prototype_outbox ORDER BY kind')
      .all() as Array<{ kind: string }>
    expect(outboxKinds.every((row) => row.kind === 'artifact')).toBe(true)

    const copiedRaw = JSON.parse(
      artifacts.find((row) => row.content_json.includes('topic-whole.raw.txt'))?.content_json ??
        '{}'
    ) as { artifactFileName: string }
    await expect(
      readFile(
        path.join(userRoot(), 'artifacts', 'meeting-raw', copiedRaw.artifactFileName),
        'utf8'
      )
    ).resolves.toBe('{ invalid model json')
  })

  it('recovers missing artifact metadata and upload outbox rows', async () => {
    const { getDb } = await import('../db/connection')
    const { recoverMissingArtifactOutbox } = await import('./artifacts')
    const db = getDb()
    const wavPath = path.join(userRoot(), 'recordings', 'meeting-recover.wav')
    await mkdir(path.dirname(wavPath), { recursive: true })
    await writeFile(wavPath, 'wav bytes', 'utf8')
    db.prepare(
      `INSERT INTO prototype_artifacts (
         id, owner_id, recording_id, kind, local_path, content_json, sha256, byte_length,
         sync_status, created_at
       )
       VALUES (
         'artifact-transcript', 'owner-1', 'meeting-recover', 'transcript', NULL, '{"ok":true}',
         'a', 11, 'pending', 1
       )`
    ).run()
    db.prepare(
      `INSERT INTO prototype_artifacts (
         id, owner_id, recording_id, kind, local_path, content_json, sha256, byte_length,
         sync_status, created_at
       )
       VALUES (
         'artifact-wav', 'owner-1', 'meeting-recover', 'wav', @wavPath, NULL,
         'b', 9, 'pending', 2
       )`
    ).run({ wavPath })

    expect(recoverMissingArtifactOutbox()).toBe(3)

    const outbox = db
      .prepare('SELECT kind, payload_json FROM prototype_outbox ORDER BY kind, created_at')
      .all() as Array<{ kind: string; payload_json: string }>
    expect(outbox.map((row) => row.kind)).toEqual(['artifact', 'artifact', 'artifact-upload'])
    expect(outbox.map((row) => JSON.parse(row.payload_json).id)).toEqual([
      'artifact-transcript',
      'artifact-wav',
      'artifact-wav'
    ])
  })
})

describe('prototype transcript reading', () => {
  beforeEach(async () => {
    vi.resetModules()
    state.owner = 'owner-1'
    state.request.mockReset()
    userDataDir = await mkdtemp(path.join(os.tmpdir(), 'meeting-stt-prototype-transcript-'))
  })

  afterEach(async () => {
    const { closeDb } = await import('../db/connection')
    closeDb()
    await rm(userDataDir, { recursive: true, force: true })
  })

  const remoteRecording = {
    id: 'recording-remote',
    title: '원격 회의',
    startedAt: '2026-09-28T01:00:00Z',
    durationMs: 2000,
    artifacts: [
      { id: 'artifact-raw', kind: 'ai_raw', completed: true },
      { id: 'artifact-transcript', kind: 'transcript', completed: true }
    ]
  }

  const remoteTranscript = {
    schemaVersion: 1,
    rawWhisperJson: { text: 'raw stt text must not be used' },
    utterances: [
      {
        id: 'u-1',
        meetingId: 'recording-remote',
        ord: 0,
        speakerLabel: 'speaker_00',
        startSec: 1,
        endSec: 3,
        text: 'normalized transcript text'
      }
    ]
  }

  it('returns local normalized utterances without remote fallback when the meeting exists', async () => {
    const { insertMeeting } = await import('../db/meetings')
    const { replaceUtterances } = await import('../db/utterances')
    const { readPrototypeTranscript } = await import('./artifacts')

    insertMeeting({
      id: 'meeting-local',
      title: '로컬 회의',
      createdAt: 1_700_000_000_000,
      audioPath: 'local.wav'
    })
    replaceUtterances({
      meetingId: 'meeting-local',
      utterances: [
        {
          ord: 0,
          speakerLabel: 'speaker_00',
          startSec: 0,
          endSec: 2,
          text: 'local transcript text'
        }
      ]
    })

    const result = await readPrototypeTranscript({ recordingId: 'meeting-local' })

    expect(result?.title).toBe('로컬 회의')
    expect(result?.utterances[0]).toMatchObject({
      text: 'local transcript text',
      meetingId: 'meeting-local'
    })
    expect(state.request).not.toHaveBeenCalled()
  })

  it('reopens a remote transcript from the normalized transcript artifact when no local meeting exists', async () => {
    state.request.mockResolvedValueOnce(remoteRecording).mockResolvedValueOnce(remoteTranscript)
    const { readPrototypeTranscript } = await import('./artifacts')

    const result = await readPrototypeTranscript({ recordingId: 'recording-remote' })

    expect(state.request).toHaveBeenNthCalledWith(1, { path: '/recordings/recording-remote' })
    expect(state.request).toHaveBeenNthCalledWith(2, {
      path: '/artifacts/artifact-transcript/content'
    })
    expect(result).toMatchObject({
      recordingId: 'recording-remote',
      title: '원격 회의',
      durationSec: 2,
      utterances: [{ text: 'normalized transcript text' }]
    })
  })

  it('문서가 지정한 전사를 열고 나중 전사로 바꾸지 않는다', async () => {
    state.request
      .mockResolvedValueOnce({
        ...remoteRecording,
        artifacts: [
          ...remoteRecording.artifacts,
          { id: 'new-transcript', kind: 'transcript', completed: true }
        ]
      })
      .mockResolvedValueOnce(remoteTranscript)
    const { readPrototypeTranscript } = await import('./artifacts')
    await readPrototypeTranscript({
      recordingId: 'recording-remote',
      artifactId: 'artifact-transcript'
    })
    expect(state.request).toHaveBeenNthCalledWith(2, {
      path: '/artifacts/artifact-transcript/content'
    })
  })

  it('rejects a remote transcript response when the owner changes between awaits', async () => {
    state.request.mockResolvedValueOnce(remoteRecording).mockImplementationOnce(async () => {
      state.owner = 'owner-2'
      return remoteTranscript
    })
    const { readPrototypeTranscript } = await import('./artifacts')

    await expect(readPrototypeTranscript({ recordingId: 'recording-remote' })).rejects.toThrow(
      '계정이 변경'
    )
  })

  it('returns null when the remote recording has no completed transcript artifact', async () => {
    state.request.mockResolvedValueOnce({
      ...remoteRecording,
      artifacts: [{ id: 'artifact-wav', kind: 'wav', completed: true }]
    })
    const { readPrototypeTranscript } = await import('./artifacts')

    await expect(readPrototypeTranscript({ recordingId: 'recording-remote' })).resolves.toBeNull()
    expect(state.request).toHaveBeenCalledTimes(1)
  })

  it('rejects remote recordings whose id does not match the requested recording id', async () => {
    state.request.mockResolvedValueOnce({ ...remoteRecording, id: 'other-recording' })
    const { readPrototypeTranscript } = await import('./artifacts')

    await expect(readPrototypeTranscript({ recordingId: 'recording-remote' })).rejects.toThrow(
      '녹음 응답'
    )
  })

  it('rejects incomplete transcript artifacts and invalid utterance timestamps', async () => {
    state.request
      .mockResolvedValueOnce({
        ...remoteRecording,
        artifacts: [{ id: 'artifact-transcript', kind: 'transcript', completed: true }]
      })
      .mockResolvedValueOnce({
        utterances: [{ ...remoteTranscript.utterances[0], startSec: 4, endSec: 3 }]
      })
    const { readPrototypeTranscript } = await import('./artifacts')

    await expect(readPrototypeTranscript({ recordingId: 'recording-remote' })).rejects.toThrow(
      '전사 산출물'
    )
  })

  it('rejects malformed remote transcript content instead of rendering raw STT text', async () => {
    state.request
      .mockResolvedValueOnce(remoteRecording)
      .mockResolvedValueOnce({ rawWhisperJson: { text: 'raw only' } })
    const { readPrototypeTranscript } = await import('./artifacts')

    await expect(readPrototypeTranscript({ recordingId: 'recording-remote' })).rejects.toThrow(
      '전사 산출물'
    )
  })
})
