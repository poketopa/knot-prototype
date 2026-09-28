/**
 * 화자 분리: pyannote 분할 → WeSpeaker 임베딩 → 전역 군집.
 * 창 사이 화자 동일성은 맞추지 않는다. 창마다 나온 구간을 전부 임베딩해 한 번에 군집하므로
 * 창 간 순열 정합이 필요 없다 (docs/browser-prototype-plan.md §3).
 */

import {
  AutoFeatureExtractor,
  AutoModel,
  AutoModelForAudioFrameClassification,
  type ProgressInfo,
  type Tensor
} from '@huggingface/transformers'

import { clusterByCompleteLinkage, l2Normalize } from '../pipeline/cluster'
import type { DiarizeRequest, DiarizeResponse } from '../pipeline/messages'
import { EMBEDDING_MODEL_ID, SEGMENTATION_MODEL_ID } from '@meeting-stt/models/web'
import { decodePowerset } from '../pipeline/powerset'
import type { SpeakerSegment } from '@meeting-stt/core/types'
import { applyWasmThreads } from './wasmThreads'
import { onHostMessage, postToHost, toErrorMessage } from './workerBridge'

/** pyannote/segmentation-3.0이 학습된 창 길이 */
const WINDOW_SEC = 10
/**
 * 창을 겹치지 않고 민다. 겹치면 경계 품질이 올라가지만 추론량이 배로 늘고,
 * 데스크탑에서도 병목이 화자 분리였다 (docs/phase1-results.md).
 */
const WINDOW_STEP_SEC = 10
/** 이보다 짧은 구간은 임베딩이 불안정해 군집을 망친다 */
const MIN_SEGMENT_SEC = 0.5
/** 같은 화자의 이웃 구간을 잇는 최대 공백 */
const MAX_MERGE_GAP_SEC = 0.5

const SEGMENTATION_PERCENT = 45
const EMBEDDING_PERCENT = 50
const PERCENT_MAX = 100

const postProgress = ({
  kind,
  percent,
  note
}: {
  kind: 'download' | 'run'
  percent: number
  note: string
}) => postToHost<DiarizeResponse>({ type: 'progress', kind, percent, note })

const downloadCallback = (label: string) => (info: ProgressInfo) => {
  if (info.status !== 'progress_total') return
  postProgress({ kind: 'download', percent: info.progress, note: `${label} 내려받는 중` })
}

interface TimedSegment {
  start: number
  end: number
}

interface SegmentAudioParams {
  samples: Float32Array
  sampleRate: number
  device: DiarizeRequest['device']
}

/** 창마다 powerset을 풀어 전체 시간축의 구간 목록을 만든다 */
const segmentAudio = async ({ samples, sampleRate, device }: SegmentAudioParams) => {
  const model = await AutoModelForAudioFrameClassification.from_pretrained(SEGMENTATION_MODEL_ID, {
    dtype: 'fp32',
    device,
    progress_callback: downloadCallback('분할 모델')
  })
  const featureExtractor = await AutoFeatureExtractor.from_pretrained(SEGMENTATION_MODEL_ID)

  const windowSamples = Math.round(WINDOW_SEC * sampleRate)
  const stepSamples = Math.round(WINDOW_STEP_SEC * sampleRate)
  const windowCount = Math.max(1, Math.ceil(samples.length / stepSamples))
  const segments: TimedSegment[] = []

  for (let index = 0; index < windowCount; index += 1) {
    const offset = index * stepSamples
    const window = samples.slice(offset, Math.min(offset + windowSamples, samples.length))
    // 너무 짧은 꼬리는 모델의 수용 영역을 못 채워 의미 있는 출력이 안 나온다
    if (window.length < sampleRate) break

    const inputs = await featureExtractor(window)
    const output = (await model(inputs)) as { logits: Tensor }
    const frameScores = output.logits.tolist()[0] as number[][]

    const windowStartSec = offset / sampleRate
    const localSegments = decodePowerset({
      frameScores,
      frameSec: window.length / sampleRate / frameScores.length,
      minSegmentSec: MIN_SEGMENT_SEC
    })

    for (const local of localSegments) {
      segments.push({ start: windowStartSec + local.start, end: windowStartSec + local.end })
    }

    postProgress({
      kind: 'run',
      percent: ((index + 1) / windowCount) * SEGMENTATION_PERCENT,
      note: `발화 구간 나누는 중 (${index + 1}/${windowCount} 창)`
    })
  }

  await model.dispose()

  return segments
}

interface EmbedSegmentsParams extends SegmentAudioParams {
  segments: TimedSegment[]
}

/** 구간마다 화자 임베딩을 뽑아 L2 정규화한다 */
const embedSegments = async ({ samples, sampleRate, device, segments }: EmbedSegmentsParams) => {
  const model = await AutoModel.from_pretrained(EMBEDDING_MODEL_ID, {
    dtype: 'fp32',
    device,
    progress_callback: downloadCallback('임베딩 모델')
  })
  const featureExtractor = await AutoFeatureExtractor.from_pretrained(EMBEDDING_MODEL_ID)

  const embeddings: Float32Array[] = []

  for (const [index, segment] of segments.entries()) {
    const window = samples.slice(
      Math.round(segment.start * sampleRate),
      Math.round(segment.end * sampleRate)
    )
    const inputs = await featureExtractor(window)
    const output = (await model(inputs)) as { last_hidden_state: Tensor }
    embeddings.push(l2Normalize(new Float32Array(output.last_hidden_state.data as Float32Array)))

    if (index % 20 === 0 || index === segments.length - 1) {
      postProgress({
        kind: 'run',
        percent: SEGMENTATION_PERCENT + ((index + 1) / segments.length) * EMBEDDING_PERCENT,
        note: `화자 임베딩 뽑는 중 (${index + 1}/${segments.length})`
      })
    }
  }

  await model.dispose()

  return embeddings
}

/** 이웃한 같은 화자 구간을 하나로 잇는다. 창 경계에서 잘린 구간이 되붙는다 */
const mergeAdjacent = (speakerSegments: SpeakerSegment[]) =>
  speakerSegments
    .toSorted((a, b) => a.start - b.start)
    .reduce<SpeakerSegment[]>((merged, segment) => {
      const last = merged.at(-1)
      const isJoinable =
        last && last.speaker === segment.speaker && segment.start - last.end <= MAX_MERGE_GAP_SEC
      if (!isJoinable) return [...merged, segment]

      return merged.with(merged.length - 1, { ...last, end: Math.max(last.end, segment.end) })
    }, [])

const toSpeakerLabel = (cluster: number) => `speaker_${String(cluster).padStart(2, '0')}`

const diarize = async ({ samples, sampleRate, speakerCount, device }: DiarizeRequest) => {
  const startedAt = performance.now()
  applyWasmThreads()

  const segments = await segmentAudio({ samples, sampleRate, device })
  const embeddings = await embedSegments({ samples, sampleRate, device, segments })

  postProgress({ kind: 'run', percent: PERCENT_MAX, note: '화자 군집 중' })
  const labels = clusterByCompleteLinkage({ embeddings, clusterCount: speakerCount })

  const speakerSegments = mergeAdjacent(
    segments.map((segment, index) => ({ ...segment, speaker: toSpeakerLabel(labels[index]) }))
  )

  return {
    speakerSegments,
    embeddingCount: embeddings.length,
    elapsedMs: performance.now() - startedAt
  }
}

onHostMessage<DiarizeRequest>(async (request) => {
  try {
    const result = await diarize(request)
    postToHost<DiarizeResponse>({ type: 'done', ...result, samples: request.samples }, [
      request.samples.buffer
    ])
  } catch (error) {
    postToHost<DiarizeResponse>({ type: 'error', message: toErrorMessage(error) })
  }
})
