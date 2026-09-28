/**
 * VAD → 무음 제거 → Whisper → 시각 되돌리기.
 * whisper.cpp의 `--vad`와 같은 순서다. 무음을 남겨두면 환각이 생기고 타임스탬프가 밀린다
 * (docs/browser-prototype-plan.md §7).
 */

import { pipeline, type ProgressInfo } from '@huggingface/transformers'

import type { DtypeKind, SttRequest, SttResponse } from '../pipeline/messages'
import { WHISPER_MODEL_IDS } from '@meeting-stt/models/web'
import { runSileroVad } from '../pipeline/sileroVad'
import {
  buildSpeechBatches,
  buildSpeechTimeline,
  concatSpeechSamples,
  restoreTime,
  toSpeechSlices,
  type TimelineEntry
} from '../pipeline/speechTimeline'
import { buildSpeechRegions } from '../pipeline/vadSegments'
import type { SttSegment, SttWord } from '@meeting-stt/core/types'
import { applyWasmThreads } from './wasmThreads'
import { onHostMessage, postToHost, toErrorMessage } from './workerBridge'

const VAD_PROGRESS_EVERY_WINDOWS = 5000

const CHUNK_LENGTH_SEC = 30
const STRIDE_LENGTH_SEC = 5
/** 한 번에 Whisper에 올리는 발화 길이. 진행률 단위이자 피크 메모리 상한이다 */
const MAX_BATCH_SPEECH_SEC = 120

const LANGUAGE = 'korean'
const TASK = 'transcribe'

const PERCENT_MAX = 100

interface WhisperChunk {
  text: string
  timestamp: [number, number | null]
}

interface WhisperOutput {
  text: string
  chunks?: WhisperChunk[]
}

const postProgress = ({
  kind,
  percent,
  note
}: {
  kind: 'download' | 'run'
  percent: number
  note: string
}) => postToHost<SttResponse>({ type: 'progress', kind, percent, note })

const downloadCallback = (label: string) => (info: ProgressInfo) => {
  if (info.status !== 'progress_total') return
  postProgress({ kind: 'download', percent: info.progress, note: `${label} 내려받는 중` })
}

const runVad = ({ samples, sampleRate }: { samples: Float32Array; sampleRate: number }) =>
  runSileroVad({
    samples,
    sampleRate,
    device: 'wasm',
    onDownload: downloadCallback('VAD 모델'),
    onWindow: ({ index, total }) => {
      if (index % VAD_PROGRESS_EVERY_WINDOWS !== 0) return
      postProgress({
        kind: 'run',
        percent: (index / total) * PERCENT_MAX,
        note: 'VAD로 발화 구간 찾는 중'
      })
    }
  })

const dtypeFor = (dtype: DtypeKind) => ({ encoder_model: dtype, decoder_model_merged: dtype })

interface ToWordsParams {
  chunks: WhisperChunk[]
  timeline: TimelineEntry[]
  batchOffsetSec: number
}

/**
 * Whisper 단어 청크를 원본 시각의 단어로 바꾼다.
 * 마지막 단어의 end가 null로 오는 경우가 있어 다음 단어의 시작으로 메운다.
 */
const toWords = ({ chunks, timeline, batchOffsetSec }: ToWordsParams) =>
  chunks.reduce<SttWord[]>((words, chunk, index) => {
    const text = chunk.text.trim()
    const start = chunk.timestamp[0]
    if (!text || start === null || start === undefined) return words

    const nextStart = chunks[index + 1]?.timestamp?.[0] ?? null
    const end = chunk.timestamp[1] ?? nextStart ?? start

    return [
      ...words,
      {
        start: restoreTime({ timeline, compressedSec: batchOffsetSec + start }),
        end: restoreTime({ timeline, compressedSec: batchOffsetSec + Math.max(end, start) }),
        text
      }
    ]
  }, [])

const transcribe = async ({ samples, sampleRate, device, dtype, whisperModel }: SttRequest) => {
  const startedAt = performance.now()
  applyWasmThreads()

  const { probabilities, windowSec } = await runVad({ samples, sampleRate })
  const vadElapsedMs = performance.now() - startedAt

  const regions = buildSpeechRegions({
    probabilities,
    windowSec,
    totalSec: samples.length / sampleRate
  })
  const slices = toSpeechSlices({ regions, sampleRate, sampleCount: samples.length })
  const timeline = buildSpeechTimeline({ slices, sampleRate })
  const batches = buildSpeechBatches({ slices, sampleRate, maxSpeechSec: MAX_BATCH_SPEECH_SEC })
  // 진행률 분모는 실제로 Whisper에 올라가는 길이여야 해서 구간 초가 아니라 샘플 수로 센다
  const speechSec =
    slices.reduce((sum, slice) => sum + slice.endSample - slice.startSample, 0) / sampleRate

  const transcriber = await pipeline(
    'automatic-speech-recognition',
    WHISPER_MODEL_IDS[whisperModel],
    {
      device,
      dtype: dtypeFor(dtype),
      progress_callback: downloadCallback('Whisper 모델')
    }
  )

  const segments: SttSegment[] = []
  let processedSpeechSec = 0

  for (const batch of batches) {
    const batchSlices = slices.slice(batch.fromIndex, batch.toIndex)
    const batchSamples = concatSpeechSamples({ samples, slices: batchSlices })
    const batchOffsetSec = timeline[batch.fromIndex].compressedStart

    const output = (await transcriber(batchSamples, {
      language: LANGUAGE,
      task: TASK,
      return_timestamps: 'word',
      chunk_length_s: CHUNK_LENGTH_SEC,
      stride_length_s: STRIDE_LENGTH_SEC
    })) as unknown as WhisperOutput

    const words = toWords({ chunks: output.chunks ?? [], timeline, batchOffsetSec })
    if (words.length > 0) {
      segments.push({
        start: words[0].start,
        end: words[words.length - 1].end,
        text: output.text.trim(),
        words
      })
    }

    processedSpeechSec += batchSamples.length / sampleRate
    postProgress({
      kind: 'run',
      percent: speechSec === 0 ? PERCENT_MAX : (processedSpeechSec / speechSec) * PERCENT_MAX,
      note: `전사 중 (${Math.round(processedSpeechSec)}s / ${Math.round(speechSec)}s)`
    })
  }

  await transcriber.dispose()

  return {
    segments,
    speechSec,
    vadElapsedMs,
    elapsedMs: performance.now() - startedAt
  }
}

onHostMessage<SttRequest>(async (request) => {
  try {
    const result = await transcribe(request)
    postToHost<SttResponse>({ type: 'done', ...result, samples: request.samples }, [
      request.samples.buffer
    ])
  } catch (error) {
    postToHost<SttResponse>({ type: 'error', message: toErrorMessage(error) })
  }
})
