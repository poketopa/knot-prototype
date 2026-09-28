/**
 * 브라우저 없이 모델 배선만 확인하는 스모크 테스트.
 * transformers.js의 입출력 이름·전처리기 선택이 맞는지 보는 것이 목적이고,
 * 성능은 여기서 재지 않는다 (Node는 onnxruntime-node, 브라우저는 WASM/WebGPU라 다른 백엔드다).
 *
 *   pnpm tsx scripts/smokeModels.ts <16kHz mono wav> [참석자 수] [정답 json]
 */

import { readFileSync } from 'node:fs'

import {
  AutoFeatureExtractor,
  AutoModel,
  AutoModelForAudioFrameClassification,
  pipeline,
  type Tensor
} from '@huggingface/transformers'

import { clusterByCompleteLinkage, l2Normalize } from '../src/pipeline/cluster'
import { measureDiarizationAccuracy, type ReferenceTurn } from '../src/pipeline/diarizeAccuracy'
import { decodePowerset } from '../src/pipeline/powerset'
import { runSileroVad } from '../src/pipeline/sileroVad'
import {
  buildSpeechTimeline,
  concatSpeechSamples,
  restoreTime,
  toSpeechSlices
} from '../src/pipeline/speechTimeline'
import { buildSpeechRegions, totalSpeechSec } from '../src/pipeline/vadSegments'
import { normalizeSamples } from '../src/pipeline/normalize'
import { assignSpeakers, mergeUtterances } from '@meeting-stt/core/merge'
import { formatTranscript } from '@meeting-stt/core/format'
import type { SpeakerSegment } from '@meeting-stt/core/types'

const SAMPLE_RATE_HZ = 16000
const WINDOW_SEC = 10
const MIN_SEGMENT_SEC = 0.5
const INT16_MAX = 32767
const WAV_HEADER_BYTES = 44

const readMonoWav = (path: string) => {
  const buffer = readFileSync(path)
  const pcm = new Int16Array(
    buffer.buffer.slice(buffer.byteOffset + WAV_HEADER_BYTES, buffer.byteOffset + buffer.length)
  )
  const samples = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i += 1) samples[i] = pcm[i] / INT16_MAX

  return samples
}

const [, , audioPath, speakerCountArg, referencePath] = process.argv
if (!audioPath) throw new Error('사용법: pnpm tsx scripts/smokeModels.ts <wav> [참석자 수]')

const speakerCount = Number(speakerCountArg ?? 3)
const samples = readMonoWav(audioPath)
const durationSec = samples.length / SAMPLE_RATE_HZ
console.log(`오디오 ${durationSec.toFixed(1)}초, 참석자 수 ${speakerCount}`)

const normalizeResult = normalizeSamples({ samples, sampleRate: SAMPLE_RATE_HZ })
console.log(
  `정규화: ${normalizeResult.speechRmsDb.toFixed(1)} → ${normalizeResult.normalizedSpeechRmsDb.toFixed(1)} dBFS (게인 ${normalizeResult.gainDb.toFixed(1)}dB)`
)

console.log('\n[1/4] VAD')
const { probabilities, windowSec } = await runSileroVad({ samples, sampleRate: SAMPLE_RATE_HZ })

const regions = buildSpeechRegions({ probabilities, windowSec, totalSec: durationSec })
console.log(`발화 구간 ${regions.length}개, 총 ${totalSpeechSec(regions).toFixed(1)}초`)

console.log('\n[2/4] 분할 (pyannote)')
const segmentationModel = await AutoModelForAudioFrameClassification.from_pretrained(
  'onnx-community/pyannote-segmentation-3.0',
  { dtype: 'fp32' }
)
const segmentationExtractor = await AutoFeatureExtractor.from_pretrained(
  'onnx-community/pyannote-segmentation-3.0'
)

const windowSamples = WINDOW_SEC * SAMPLE_RATE_HZ
const segments: { start: number; end: number }[] = []

for (let offset = 0; offset < samples.length; offset += windowSamples) {
  const window = samples.slice(offset, Math.min(offset + windowSamples, samples.length))
  if (window.length < SAMPLE_RATE_HZ) break

  const inputs = await segmentationExtractor(window)
  const output = (await segmentationModel(inputs)) as { logits: Tensor }
  const frameScores = output.logits.tolist()[0] as number[][]

  for (const local of decodePowerset({
    frameScores,
    frameSec: window.length / SAMPLE_RATE_HZ / frameScores.length,
    minSegmentSec: MIN_SEGMENT_SEC
  })) {
    segments.push({
      start: offset / SAMPLE_RATE_HZ + local.start,
      end: offset / SAMPLE_RATE_HZ + local.end
    })
  }
}
console.log(`창별 구간 ${segments.length}개 (프레임 해상도 확인 완료)`)

console.log('\n[3/4] 임베딩 (wespeaker) + 군집')
const embeddingModel = await AutoModel.from_pretrained(
  'onnx-community/wespeaker-voxceleb-resnet34-LM',
  { dtype: 'fp32' }
)
const embeddingExtractor = await AutoFeatureExtractor.from_pretrained(
  'onnx-community/wespeaker-voxceleb-resnet34-LM'
)

const embeddings: Float32Array[] = []
for (const segment of segments) {
  const window = samples.slice(
    Math.round(segment.start * SAMPLE_RATE_HZ),
    Math.round(segment.end * SAMPLE_RATE_HZ)
  )
  const inputs = await embeddingExtractor(window)
  const output = (await embeddingModel(inputs)) as { last_hidden_state: Tensor }
  embeddings.push(l2Normalize(new Float32Array(output.last_hidden_state.data as Float32Array)))
}
console.log(`임베딩 ${embeddings.length}개, 차원 ${embeddings[0]?.length ?? 0}`)

const labels = clusterByCompleteLinkage({ embeddings, clusterCount: speakerCount })
const speakerSegments: SpeakerSegment[] = segments.map((segment, index) => ({
  ...segment,
  speaker: `speaker_${String(labels[index]).padStart(2, '0')}`
}))
console.log(`클러스터 ${new Set(labels).size}개`)

if (referencePath) {
  const reference = JSON.parse(readFileSync(referencePath, 'utf8')) as ReferenceTurn[]
  const measured = measureDiarizationAccuracy({ speakerSegments, reference, durationSec })
  console.log(
    `화자 정확도 ${(measured.accuracy * 100).toFixed(1)}% (정답 ${measured.referenceSpeakerCount}명 / 예측 ${measured.predictedSpeakerCount}명, ${measured.scoredSec.toFixed(1)}초 채점)`
  )
}

console.log('\n[4/4] STT (whisper tiny) + 병합')
const slices = toSpeechSlices({ regions, sampleRate: SAMPLE_RATE_HZ, sampleCount: samples.length })
const timeline = buildSpeechTimeline({ slices, sampleRate: SAMPLE_RATE_HZ })
const speechSamples = concatSpeechSamples({ samples, slices })

const transcriber = await pipeline(
  'automatic-speech-recognition',
  'onnx-community/whisper-tiny_timestamped',
  { dtype: { encoder_model: 'fp32', decoder_model_merged: 'fp32' } }
)
const output = (await transcriber(speechSamples, {
  language: 'korean',
  task: 'transcribe',
  return_timestamps: 'word',
  chunk_length_s: 30,
  stride_length_s: 5
})) as unknown as { text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }

const words = (output.chunks ?? [])
  .filter((chunk) => chunk.timestamp[0] !== null && chunk.text.trim())
  .map((chunk, index, all) => {
    const start = chunk.timestamp[0] as number
    const end = chunk.timestamp[1] ?? all[index + 1]?.timestamp?.[0] ?? start
    return {
      start: restoreTime({ timeline, compressedSec: start }),
      end: restoreTime({ timeline, compressedSec: Math.max(end, start) }),
      text: chunk.text.trim()
    }
  })

console.log(`단어 ${words.length}개 (단어 타임스탬프 동작 여부가 여기서 갈린다)`)

const utterances = mergeUtterances(
  assignSpeakers({
    segments:
      words.length > 0
        ? [{ start: words[0].start, end: words[words.length - 1].end, text: output.text, words }]
        : [],
    speakerSegments,
    isMinorSpeakerAbsorbed: false
  })
)

console.log(`\n발화 ${utterances.length}개\n`)
console.log(formatTranscript({ utterances }).split('\n').slice(0, 15).join('\n'))
