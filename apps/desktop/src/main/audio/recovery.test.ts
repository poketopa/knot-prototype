import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { BITS_PER_SAMPLE, CHANNELS, SAMPLE_RATE_HZ } from '@shared/audio'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildWavHeader } from './wavWriter'

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir
  },
  BrowserWindow: {
    getAllWindows: () => []
  }
}))

vi.mock('../prototype/authState', () => ({
  requirePrototypeUser: () => ({ id: 'owner-1', displayName: 'Owner' }),
  prototypeUserRoot: () => path.join(userDataDir, 'prototype', 'users', 'owner-1')
}))

const userRoot = () => path.join(userDataDir, 'prototype', 'users', 'owner-1')
const recordingsRoot = () => path.join(userRoot(), 'recordings')

const insertMeeting = async ({
  id,
  status = 'recording',
  audioPath
}: {
  id: string
  status?: 'recording' | 'processing' | 'done' | 'error'
  audioPath: string
}) => {
  const { getDb } = await import('../db/connection')
  getDb()
    .prepare(
      `INSERT INTO meetings (id, owner_id, title, created_at, duration_sec, status, audio_path)
       VALUES (@id, 'owner-1', @title, 1000, 0, @status, @audioPath)`
    )
    .run({ id, title: `${id} title`, status, audioPath })
}

describe('interrupted recording recovery', () => {
  beforeEach(async () => {
    vi.resetModules()
    userDataDir = await mkdtemp(path.join(os.tmpdir(), 'meeting-stt-prototype-recording-recovery-'))
    await mkdir(recordingsRoot(), { recursive: true })
  })

  afterEach(async () => {
    const { closeDb } = await import('../db/connection')
    closeDb()
    await rm(userDataDir, { recursive: true, force: true })
  })

  it('repairs an unfinalized own WAV and restarts transcript processing', async () => {
    const meetingId = '00000000-0000-4000-8000-000000000101'
    const audioPath = path.join(recordingsRoot(), `${meetingId}.wav`)
    const dataBytes = SAMPLE_RATE_HZ * CHANNELS * (BITS_PER_SAMPLE / 8) * 2
    await writeFile(
      audioPath,
      Buffer.concat([buildWavHeader({ dataBytes: 0 }), Buffer.alloc(dataBytes)])
    )
    await insertMeeting({ id: meetingId, audioPath })

    const { getDb } = await import('../db/connection')
    const existingPayload = {
      id: meetingId,
      startedAt: '2026-09-28T00:00:01.000Z',
      endedAt: '2026-09-28T00:00:05.000Z',
      durationMs: 4000,
      title: 'original metadata'
    }
    getDb()
      .prepare(
        `INSERT INTO prototype_outbox (
           id, owner_id, kind, payload_json, status, attempt_count, next_retry_at, created_at
         )
         VALUES (
           'existing-recording', 'owner-1', 'recording', @payloadJson,
           'pending', 0, 0, 1
         )`
      )
      .run({ payloadJson: JSON.stringify(existingPayload) })
    const { failStaleMeetings } = await import('../db/meetings')
    const { recoverPrototypeJobs } = await import('../prototype/jobs')
    const { recoverInterruptedRecordings } = await import('./recovery')

    await expect(recoverInterruptedRecordings()).resolves.toEqual({
      recoveredRecordings: 1,
      recoveredWhisperJson: 0
    })

    const header = await readFile(audioPath).then((buffer) => buffer.subarray(0, 44))
    expect(header.readUInt32LE(40)).toBe(dataBytes)
    await expect(stat(`${audioPath}.unfinalized-header.bak`)).resolves.toMatchObject({ size: 44 })

    const meeting = getDb()
      .prepare('SELECT duration_sec, status, error_message FROM meetings WHERE id = ?')
      .get(meetingId) as { duration_sec: number; status: string; error_message: string | null }
    expect(meeting.status).toBe('processing')
    expect(meeting.error_message).toBeNull()
    expect(meeting.duration_sec).toBe(2)
    expect(failStaleMeetings()).toBe(0)

    expect(recoverPrototypeJobs()).toEqual([{ recording_id: meetingId, kind: 'transcript' }])
    const outboxKinds = getDb()
      .prepare('SELECT kind FROM prototype_outbox ORDER BY kind')
      .all() as Array<{ kind: string }>
    expect(outboxKinds.map((row) => row.kind)).toEqual(['artifact', 'artifact-upload', 'recording'])
    const recordingOutbox = getDb()
      .prepare("SELECT payload_json FROM prototype_outbox WHERE kind = 'recording'")
      .all() as Array<{ payload_json: string }>
    expect(recordingOutbox).toEqual([{ payload_json: JSON.stringify(existingPayload) }])
  })

  it('marks a malformed interrupted WAV failed and continues recovering other recordings', async () => {
    const badMeetingId = '00000000-0000-4000-8000-000000000103'
    const goodMeetingId = '00000000-0000-4000-8000-000000000104'
    const badAudioPath = path.join(recordingsRoot(), `${badMeetingId}.wav`)
    const goodAudioPath = path.join(recordingsRoot(), `${goodMeetingId}.wav`)
    const dataBytes = SAMPLE_RATE_HZ * CHANNELS * (BITS_PER_SAMPLE / 8) * 2
    await writeFile(badAudioPath, 'not a wav', 'utf8')
    await writeFile(
      goodAudioPath,
      Buffer.concat([buildWavHeader({ dataBytes: 0 }), Buffer.alloc(dataBytes)])
    )
    await insertMeeting({ id: badMeetingId, audioPath: badAudioPath })
    await insertMeeting({ id: goodMeetingId, audioPath: goodAudioPath })

    const { getDb } = await import('../db/connection')
    const { recoverInterruptedRecordings } = await import('./recovery')

    await expect(recoverInterruptedRecordings()).resolves.toEqual({
      recoveredRecordings: 1,
      recoveredWhisperJson: 0
    })

    const rows = getDb()
      .prepare('SELECT id, status, error_message FROM meetings ORDER BY id')
      .all() as Array<{ id: string; status: string; error_message: string | null }>
    expect(rows).toEqual([
      {
        id: badMeetingId,
        status: 'error',
        error_message: '중단된 녹음 파일을 복구하지 못했습니다'
      },
      { id: goodMeetingId, status: 'processing', error_message: null }
    ])
    const jobs = getDb()
      .prepare(
        'SELECT recording_id, status, stage, last_error FROM prototype_jobs ORDER BY recording_id'
      )
      .all() as Array<{
      recording_id: string
      status: string
      stage: string
      last_error: string
    }>
    expect(jobs).toEqual([
      expect.objectContaining({
        recording_id: badMeetingId,
        status: 'failed',
        stage: 'error'
      }),
      expect.objectContaining({
        recording_id: goodMeetingId,
        status: 'pending',
        stage: 'transcribing'
      })
    ])
  })

  it('registers orphan whisper JSON before removing it', async () => {
    const meetingId = '00000000-0000-4000-8000-000000000102'
    const audioPath = path.join(recordingsRoot(), `${meetingId}.wav`)
    const rawWhisperJson = '{ invalid whisper json'
    await writeFile(audioPath, buildWavHeader({ dataBytes: 0 }))
    await writeFile(`${audioPath}.whisper.json`, rawWhisperJson, 'utf8')
    await insertMeeting({ id: meetingId, status: 'done', audioPath })

    const { getDb } = await import('../db/connection')
    const { recoverInterruptedRecordings } = await import('./recovery')

    await expect(recoverInterruptedRecordings()).resolves.toEqual({
      recoveredRecordings: 0,
      recoveredWhisperJson: 1
    })
    await expect(stat(`${audioPath}.whisper.json`)).rejects.toMatchObject({ code: 'ENOENT' })

    const artifact = getDb()
      .prepare(
        "SELECT content_json FROM prototype_artifacts WHERE recording_id = ? AND kind = 'transcript'"
      )
      .get(meetingId) as { content_json: string }
    expect(artifact.content_json).toContain(rawWhisperJson)
  })
})
