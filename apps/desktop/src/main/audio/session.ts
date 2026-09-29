import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { powerSaveBlocker } from 'electron'
import path from 'node:path'
import { rmsOf, SAMPLE_RATE_HZ } from '@shared/audio'
import type { RecordingStateEvent } from '@shared/ipc'
import {
  findMeeting,
  insertMeeting,
  updateMeetingDuration,
  updateMeetingSpeakerCount,
  updateMeetingStatus
} from '../db/meetings'
import { info, warn } from '../log'
import { notifyMeetingsChanged } from '../meetingsChanged'
import { enqueuePipelineJob } from '../pipeline/queue'
import { preserveAudioArtifact } from '../prototype/artifacts'
import { prototypeUserRoot } from '../prototype/authState'
import { trackPrototypeEvent } from '../prototype/events'
import { upsertPrototypeJob } from '../prototype/jobs'
import { enqueueOutbox } from '../prototype/outbox'
import { createWavWriter, type WavWriter } from './wavWriter'

/** 이보다 짧으면 사실상 빈 녹음이라 파이프라인을 돌리지 않는다 */
const MIN_RECORDING_SEC = 1

interface RecordingSession {
  meetingId: string
  startedAt: number
  audioPath: string
  writer: WavWriter
  level: number
  sleepBlockerId: number
}

/**
 * 진행 중 녹음의 단일 출처. 오디오 그래프는 메인 renderer가 들고 있고, 상태는 여기에만 있다.
 */
let session: RecordingSession | null = null
let isStarting = false

/**
 * 참석자 수는 세션 밖에 둔다 — 녹음 시작 전에도 입력할 수 있고, 정지 후에도 남아 다음 녹음에 그대로 쓰인다.
 * 두 창의 입력란에 계속 보이므로 숨은 값이 아니다.
 */
let speakerCount: number | undefined

let notifyState: (event: RecordingStateEvent) => void = () => {}

export const recordingsDir = () => path.join(prototypeUserRoot(), 'recordings')

const pad2 = (value: number) => String(value).padStart(2, '0')

/** 기본 제목은 "2026-08-26 회의" (references/data-model.md) */
const defaultTitle = (createdAt: number) => {
  const date = new Date(createdAt)

  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} 회의`
}

/** main이 창을 만든 뒤 한 번 등록한다. 창이 없을 때 보내면 무시된다 */
export const setRecordingStateListener = (listener: (event: RecordingStateEvent) => void) => {
  notifyState = listener
}

export const getRecordingState = (): RecordingStateEvent => ({
  meetingId: session?.meetingId ?? null,
  startedAt: session?.startedAt ?? null,
  level: session?.level ?? 0,
  speakerCount
})

/** `stoppedMeetingId`·`errorMessage`처럼 한 번만 실리는 값은 여기서 얹는다 */
const publish = (extra: Partial<RecordingStateEvent> = {}) =>
  notifyState({ ...getRecordingState(), ...extra })

export const isRecording = () => session !== null

export const isRecordingBusy = () => isStarting || session !== null

const sessionOf = (meetingId: string) => {
  if (session?.meetingId !== meetingId) throw new Error('진행 중인 녹음이 아닙니다')

  return session
}

/** 회의 행과 WAV 파일을 함께 만든다. id를 먼저 정해야 파일 이름이 정해진다 */
export const startRecording = async ({ sampleRate }: { sampleRate: number }) => {
  if (session || isStarting) throw new Error('이미 녹음이 진행 중입니다')
  if (sampleRate !== SAMPLE_RATE_HZ) {
    throw new Error(
      `이 마이크는 ${SAMPLE_RATE_HZ}Hz 녹음을 지원하지 않습니다 (현재 ${sampleRate}Hz)`
    )
  }

  isStarting = true
  try {
    const meetingId = randomUUID()
    const createdAt = Date.now()
    const audioPath = path.join(recordingsDir(), `${meetingId}.wav`)

    await mkdir(recordingsDir(), { recursive: true })
    const writer = await createWavWriter({ filePath: audioPath })
    insertMeeting({ id: meetingId, title: defaultTitle(createdAt), createdAt, audioPath })
    session = {
      meetingId,
      startedAt: createdAt,
      audioPath,
      writer,
      level: 0,
      sleepBlockerId: powerSaveBlocker.start('prevent-app-suspension')
    }
    info(`녹음 시작 ${meetingId}`)
    trackPrototypeEvent({ eventType: 'recording_started', recordingId: meetingId })
    publish()
    notifyMeetingsChanged()

    return { meetingId }
  } finally {
    isStarting = false
  }
}

export const appendRecordingChunk = async ({
  meetingId,
  pcm
}: {
  meetingId: string
  pcm: ArrayBuffer
}) => {
  // 끝난 녹음이나 남은 오디오 그래프가 보낸 청크다. 사용자에게 알릴 실패가 아니라 버린다 (references/pitfalls.md)
  if (session?.meetingId !== meetingId) {
    warn(`진행 중이 아닌 녹음의 청크를 버렸습니다 ${meetingId}`)
    return
  }

  const active = session
  const samples = new Float32Array(pcm)

  await active.writer.appendChunk(samples)
  // 레벨 미터는 여기서 계산해 두 창에 같은 값을 보낸다 (renderer마다 따로 재지 않는다)
  active.level = rmsOf(samples)
  publish()
}

/** 헤더를 확정하고 파이프라인 잡을 큐에 넣는다 */
export const stopRecording = async ({ meetingId }: { meetingId: string }) => {
  const active = sessionOf(meetingId)
  const { durationSec } = await active.writer.finalize()
  powerSaveBlocker.stop(active.sleepBlockerId)
  session = null
  updateMeetingDuration({ meetingId, durationSec })
  const endedAt = Date.now()
  const elapsedSec = Math.max(0, (endedAt - active.startedAt) / 1000)
  const missingAudioSec = Math.max(0, elapsedSec - durationSec)
  const recordingWarning =
    missingAudioSec > Math.max(10, elapsedSec * 0.01)
      ? `녹음 경과 시간과 저장된 음성 길이가 약 ${Math.round(missingAudioSec / 60)}분 차이 납니다. 잠자기나 마이크 중단 여부를 확인해 주세요. 저장된 원본은 보관합니다.`
      : undefined
  // 원본을 바꾸지 않고 시간 차이를 남긴다. 실제로 입력되지 않은 음성을 복구한 것으로 표시하지 않는다.
  await writeFile(
    `${active.audioPath}.capture.json`,
    JSON.stringify({
      schemaVersion: 1,
      startedAt: active.startedAt,
      endedAt,
      elapsedSec,
      capturedSec: durationSec,
      ...(recordingWarning ? { warning: recordingWarning } : {})
    }),
    { flag: 'wx' }
  ).catch((caught: unknown) => warn(`녹음 시간 진단 저장 실패 ${meetingId}: ${String(caught)}`))
  const meetingBeforeProcessing = findMeeting({ meetingId })
  if (!meetingBeforeProcessing) throw new Error('회의 정보를 찾을 수 없습니다')
  enqueueOutbox({
    kind: 'recording',
    payload: {
      id: meetingId,
      startedAt: new Date(meetingBeforeProcessing.createdAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      durationMs: Math.round(durationSec * 1000),
      title: meetingBeforeProcessing.title
    }
  })
  await preserveAudioArtifact({ recordingId: meetingId, audioPath: active.audioPath })
  if (speakerCount) updateMeetingSpeakerCount({ meetingId, speakerCount })
  info(
    `녹음 종료 ${meetingId} (${durationSec.toFixed(1)}초${speakerCount ? `, 참석자 ${speakerCount}명` : ''})`
  )

  if (durationSec < MIN_RECORDING_SEC) {
    updateMeetingStatus({
      meetingId,
      status: 'error',
      errorMessage: '녹음이 너무 짧아 회의록을 만들지 못했습니다'
    })
  } else {
    upsertPrototypeJob({
      recordingId: meetingId,
      kind: 'transcript',
      status: 'pending',
      stage: 'transcribing'
    })
    enqueuePipelineJob({ meetingId })
  }

  publish({
    stoppedMeetingId: meetingId,
    ...(recordingWarning ? { errorMessage: recordingWarning } : {})
  })
  trackPrototypeEvent({
    eventType: 'recording_finished',
    recordingId: meetingId,
    durationMs: Math.round(durationSec * 1000)
  })
  notifyMeetingsChanged()

  const meeting = findMeeting({ meetingId })
  if (!meeting) throw new Error('회의 정보를 찾을 수 없습니다')

  return meeting
}

/** 값이 바뀌면 두 창의 입력란이 같은 값을 보도록 바로 알린다. 검증은 핸들러가 끝냈다 */
export const setRecordingSpeakerCount = (next: number | undefined) => {
  speakerCount = next
  publish()

  return getRecordingState()
}

/**
 * 마이크 권한 거부처럼 renderer에서 알 수 있는 실패를 main 세션 상태에 전한다.
 */
export const reportRecordingError = ({ message }: { message: string }) =>
  publish({ errorMessage: message })

/**
 * 종료 직전에 진행 중 녹음을 마무리한다. 헤더가 확정되지 않은 WAV는 파이프라인이 읽지 못한다.
 * Phase 5-3부터 화면 이동으로 정지되지 않으므로 이 경로가 마지막 방어선이다.
 */
export const finalizeActiveRecording = async () => {
  if (!session) return false

  await stopRecording({ meetingId: session.meetingId })

  return true
}
