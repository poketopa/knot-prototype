/**
 * 워커 두 개를 **순차로** 띄우고 끝나면 즉시 terminate 한다.
 * WASM 메모리는 한 번 늘면 줄지 않으므로 동시에 띄우면 피크가 두 엔진의 합이 된다.
 * 오디오 배열은 워커에 소유권을 넘겼다가 돌려받아 복사를 만들지 않는다.
 */

import DiarizeWorker from '../workers/diarizeWorker?worker'
import SttWorker from '../workers/sttWorker?worker'

import { assignSpeakers, mergeUtterances } from '@meeting-stt/core/merge'
import type { MergedUtterance, SpeakerSegment, SttSegment } from '@meeting-stt/core/types'
import type {
  DeviceKind,
  DiarizeDoneMessage,
  DiarizeRequest,
  DtypeKind,
  PipelineStage,
  SttDoneMessage,
  SttRequest,
  WhisperModelKind,
  WorkerProgressMessage
} from './messages'

export interface PipelineProgress {
  stage: PipelineStage
  kind: 'download' | 'run'
  percent: number
  note: string
}

export interface PipelineTimings {
  diarizeMs: number
  vadMs: number
  sttMs: number
  mergeMs: number
}

export interface PipelineResult {
  /** 워커를 오가며 소유권이 옮겨 다닌 오디오. 다시 돌리려면 호출자가 받아 둬야 한다 */
  samples: Float32Array
  utterances: MergedUtterance[]
  speakerSegments: SpeakerSegment[]
  sttSegments: SttSegment[]
  embeddingCount: number
  speechSec: number
  timings: PipelineTimings
}

interface RunWorkerParams<TRequest extends { samples: Float32Array }> {
  worker: Worker
  request: TRequest
  stage: PipelineStage
  onProgress: (progress: PipelineProgress) => void
  signal: AbortSignal
}

type WorkerMessage = WorkerProgressMessage | { type: 'error'; message: string } | { type: 'done' }

const runWorker = <TRequest extends { samples: Float32Array }, TDone>({
  worker,
  request,
  stage,
  onProgress,
  signal
}: RunWorkerParams<TRequest>) =>
  new Promise<TDone>((resolve, reject) => {
    const abort = () => reject(new Error('사용자가 중단했습니다'))
    signal.addEventListener('abort', abort, { once: true })

    worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
      const message = event.data

      if (message.type === 'progress') {
        onProgress({ stage, kind: message.kind, percent: message.percent, note: message.note })
        return
      }
      if (message.type === 'error') {
        reject(new Error(message.message))
        return
      }

      resolve(message as TDone)
    })
    worker.addEventListener('error', (event) =>
      reject(new Error(event.message || '워커가 예기치 않게 멈췄습니다'))
    )

    worker.postMessage(request, [request.samples.buffer])
  })

export interface RunPipelineParams {
  samples: Float32Array
  sampleRate: number
  speakerCount: number
  sttDevice: DeviceKind
  sttDtype: DtypeKind
  whisperModel: WhisperModelKind
  diarizeDevice: DeviceKind
  onProgress: (progress: PipelineProgress) => void
  signal: AbortSignal
}

export const runPipeline = async ({
  samples,
  sampleRate,
  speakerCount,
  sttDevice,
  sttDtype,
  whisperModel,
  diarizeDevice,
  onProgress,
  signal
}: RunPipelineParams): Promise<PipelineResult> => {
  const diarizeWorker = new DiarizeWorker()
  let diarizeResult: DiarizeDoneMessage

  try {
    diarizeResult = await runWorker<DiarizeRequest, DiarizeDoneMessage>({
      worker: diarizeWorker,
      request: { samples, sampleRate, speakerCount, device: diarizeDevice },
      stage: 'diarize',
      onProgress,
      signal
    })
  } finally {
    diarizeWorker.terminate()
  }

  const sttWorker = new SttWorker()
  let sttResult: SttDoneMessage

  try {
    sttResult = await runWorker<SttRequest, SttDoneMessage>({
      worker: sttWorker,
      request: {
        samples: diarizeResult.samples,
        sampleRate,
        device: sttDevice,
        dtype: sttDtype,
        whisperModel
      },
      stage: 'stt',
      onProgress,
      signal
    })
  } finally {
    sttWorker.terminate()
  }

  onProgress({ stage: 'merge', kind: 'run', percent: 0, note: '화자와 전사 합치는 중' })
  const mergeStartedAt = performance.now()
  const utterances = mergeUtterances(
    assignSpeakers({
      segments: sttResult.segments,
      speakerSegments: diarizeResult.speakerSegments,
      // 참석자 수로 군집을 고정했으므로 클러스터가 전부 실제 화자다. 흡수하면 짧게 말한 참석자가 사라진다
      isMinorSpeakerAbsorbed: false
    })
  )
  const mergeMs = performance.now() - mergeStartedAt
  onProgress({ stage: 'merge', kind: 'run', percent: 100, note: '완료' })

  return {
    samples: sttResult.samples,
    utterances,
    speakerSegments: diarizeResult.speakerSegments,
    sttSegments: sttResult.segments,
    embeddingCount: diarizeResult.embeddingCount,
    speechSec: sttResult.speechSec,
    timings: {
      diarizeMs: diarizeResult.elapsedMs,
      vadMs: sttResult.vadElapsedMs,
      sttMs: sttResult.elapsedMs,
      mergeMs
    }
  }
}
