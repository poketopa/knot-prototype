import { existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { getDb } from '../db/connection'
import { updateMeetingDuration, updateMeetingStatus } from '../db/meetings'
import { preserveAudioArtifact, preserveTranscriptArtifact } from '../prototype/artifacts'
import { prototypeUserRoot, requirePrototypeUser } from '../prototype/authState'
import { enqueueOutbox } from '../prototype/outbox'
import { upsertPrototypeJob } from '../prototype/jobs'
import { repairPrototypeWavHeader } from './wavWriter'
import { messageOf } from '../log'

const MIN_RECORDING_SEC = 1

const recordingsDir = () => path.join(prototypeUserRoot(), 'recordings')

interface InterruptedRecordingRow {
  id: string
  title: string
  created_at: number
  audio_path: string
  status: 'recording' | 'processing'
}

interface KnownRecordingRow {
  id: string
  audio_path: string | null
}

const isOwnRecordingPath = ({ meetingId, audioPath }: { meetingId: string; audioPath: string }) => {
  const expectedDir = path.resolve(recordingsDir())
  const resolved = path.resolve(audioPath)

  return path.dirname(resolved) === expectedDir && path.basename(resolved) === `${meetingId}.wav`
}

const interruptedRecordings = () => {
  const owner = requirePrototypeUser()

  return getDb()
    .prepare(
      `SELECT id, title, created_at, audio_path, status
       FROM meetings
       WHERE owner_id = @ownerId
         AND status IN ('recording', 'processing')
         AND audio_path IS NOT NULL
       ORDER BY created_at`
    )
    .all({ ownerId: owner.id }) as InterruptedRecordingRow[]
}

const knownRecordings = () => {
  const owner = requirePrototypeUser()

  return getDb()
    .prepare(
      `SELECT id, audio_path
       FROM meetings
       WHERE owner_id = @ownerId
         AND audio_path IS NOT NULL
       ORDER BY created_at`
    )
    .all({ ownerId: owner.id }) as KnownRecordingRow[]
}

const enqueueRecoveredRecordingMetadata = ({
  meetingId,
  title,
  createdAt,
  durationSec
}: {
  meetingId: string
  title: string
  createdAt: number
  durationSec: number
}) => {
  const owner = requirePrototypeUser()
  const existing = getDb()
    .prepare(
      `SELECT 1
       FROM prototype_outbox
       WHERE owner_id = @ownerId
         AND kind = 'recording'
         AND json_extract(payload_json, '$.id') = @meetingId
       LIMIT 1`
    )
    .get({ ownerId: owner.id, meetingId })
  if (existing) return

  enqueueOutbox({
    kind: 'recording',
    payload: {
      id: meetingId,
      startedAt: new Date(createdAt).toISOString(),
      endedAt: new Date(createdAt + Math.round(durationSec * 1000)).toISOString(),
      durationMs: Math.round(durationSec * 1000),
      title
    }
  })
}

const recoverInterruptedRecording = async (row: InterruptedRecordingRow) => {
  if (!isOwnRecordingPath({ meetingId: row.id, audioPath: row.audio_path })) return false
  if (!existsSync(row.audio_path)) {
    updateMeetingStatus({
      meetingId: row.id,
      status: 'error',
      errorMessage: '중단된 녹음 파일을 찾을 수 없습니다'
    })
    upsertPrototypeJob({
      recordingId: row.id,
      kind: 'transcript',
      status: 'failed',
      stage: 'error',
      error: 'INTERRUPTED_RECORDING_RECOVERY_FAILED'
    })
    return false
  }

  let durationSec: number
  try {
    ;({ durationSec } = await repairPrototypeWavHeader({ filePath: row.audio_path }))
  } catch (caught) {
    updateMeetingStatus({
      meetingId: row.id,
      status: 'error',
      errorMessage: '중단된 녹음 파일을 복구하지 못했습니다'
    })
    upsertPrototypeJob({
      recordingId: row.id,
      kind: 'transcript',
      status: 'failed',
      stage: 'error',
      error: `INTERRUPTED_RECORDING_RECOVERY_FAILED: ${messageOf(caught)}`
    })
    return false
  }
  updateMeetingDuration({ meetingId: row.id, durationSec })
  enqueueRecoveredRecordingMetadata({
    meetingId: row.id,
    title: row.title,
    createdAt: row.created_at,
    durationSec
  })
  await preserveAudioArtifact({ recordingId: row.id, audioPath: row.audio_path })

  if (durationSec < MIN_RECORDING_SEC) {
    updateMeetingStatus({
      meetingId: row.id,
      status: 'error',
      errorMessage: '녹음이 너무 짧아 회의록을 만들지 못했습니다'
    })
    return true
  }

  updateMeetingStatus({ meetingId: row.id, status: 'processing' })
  upsertPrototypeJob({
    recordingId: row.id,
    kind: 'transcript',
    status: 'pending',
    stage: 'transcribing'
  })

  return true
}

const recoverOrphanWhisperJson = async (row: KnownRecordingRow) => {
  if (!row.audio_path || !isOwnRecordingPath({ meetingId: row.id, audioPath: row.audio_path })) {
    return false
  }

  const jsonPath = `${row.audio_path}.whisper.json`
  if (!existsSync(jsonPath)) return false

  const rawWhisperJson = await readFile(jsonPath, 'utf8')
  await preserveTranscriptArtifact({
    recordingId: row.id,
    rawWhisperJson,
    utterances: []
  })
  await rm(jsonPath, { force: true })

  return true
}

export const recoverInterruptedRecordings = async () => {
  let recoveredRecordings = 0
  for (const row of interruptedRecordings()) {
    if (await recoverInterruptedRecording(row)) recoveredRecordings += 1
  }

  let recoveredWhisperJson = 0
  for (const row of knownRecordings()) {
    if (await recoverOrphanWhisperJson(row)) recoveredWhisperJson += 1
  }

  return { recoveredRecordings, recoveredWhisperJson }
}
