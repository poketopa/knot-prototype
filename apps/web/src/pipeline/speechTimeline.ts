/**
 * 무음을 잘라낸 오디오와, 거기서 나온 시각을 원래 시각으로 되돌리는 표.
 * whisper.cpp의 `--vad`가 하는 일과 같다. 무음을 남겨두면 Whisper가 환각을 만들고
 * 타임스탬프가 밀려 화자 경계 단어가 앞 화자에게 붙는다 (docs/browser-prototype-plan.md §7).
 */

import type { SpeechRegion } from './vadSegments'

export interface SpeechSlice {
  startSample: number
  endSample: number
}

export interface TimelineEntry {
  /** 무음을 잘라낸 오디오에서의 시작 시각(초) */
  compressedStart: number
  /** 원본 오디오에서의 시작 시각(초) */
  originalStart: number
  durationSec: number
}

interface ToSpeechSlicesParams {
  regions: SpeechRegion[]
  sampleRate: number
  sampleCount: number
}

/** 초 단위 구간을 샘플 인덱스로 바꾼다. 이후 계산은 전부 샘플 기준이라 시각이 어긋나지 않는다 */
export const toSpeechSlices = ({ regions, sampleRate, sampleCount }: ToSpeechSlicesParams) =>
  regions
    .map((region) => ({
      startSample: Math.max(0, Math.round(region.start * sampleRate)),
      endSample: Math.min(sampleCount, Math.round(region.end * sampleRate))
    }))
    .filter((slice) => slice.endSample > slice.startSample)

interface SliceParams {
  slices: SpeechSlice[]
  sampleRate: number
}

export const buildSpeechTimeline = ({ slices, sampleRate }: SliceParams): TimelineEntry[] => {
  let compressedSamples = 0

  return slices.map((slice) => {
    const entry: TimelineEntry = {
      compressedStart: compressedSamples / sampleRate,
      originalStart: slice.startSample / sampleRate,
      durationSec: (slice.endSample - slice.startSample) / sampleRate
    }
    compressedSamples += slice.endSample - slice.startSample

    return entry
  })
}

interface RestoreTimeParams {
  timeline: TimelineEntry[]
  compressedSec: number
}

/** 무음을 잘라낸 오디오의 시각을 원본 시각으로 되돌린다 */
export const restoreTime = ({ timeline, compressedSec }: RestoreTimeParams) => {
  if (timeline.length === 0) return compressedSec

  let low = 0
  let high = timeline.length - 1
  let found = 0

  while (low <= high) {
    const mid = (low + high) >> 1
    if (timeline[mid].compressedStart <= compressedSec) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  const entry = timeline[found]
  const offset = Math.min(Math.max(compressedSec - entry.compressedStart, 0), entry.durationSec)

  return entry.originalStart + offset
}

/** 발화 구간만 이어 붙인 새 배열 */
export const concatSpeechSamples = ({
  samples,
  slices
}: {
  samples: Float32Array
  slices: SpeechSlice[]
}) => {
  const total = slices.reduce((sum, slice) => sum + slice.endSample - slice.startSample, 0)
  const concatenated = new Float32Array(total)
  let offset = 0

  for (const slice of slices) {
    concatenated.set(samples.subarray(slice.startSample, slice.endSample), offset)
    offset += slice.endSample - slice.startSample
  }

  return concatenated
}

export interface SpeechBatch {
  fromIndex: number
  toIndex: number
}

/**
 * 구간을 배치로 묶는다. 배치 경계는 항상 침묵 위에 있어 단어가 잘리지 않고,
 * 한 번에 올리는 오디오 길이가 제한되므로 진행률을 낼 수 있다.
 */
export const buildSpeechBatches = ({
  slices,
  sampleRate,
  maxSpeechSec
}: SliceParams & { maxSpeechSec: number }) => {
  const maxSamples = Math.round(maxSpeechSec * sampleRate)
  const batches: SpeechBatch[] = []
  let fromIndex = 0
  let runningSamples = 0

  slices.forEach((slice, index) => {
    const length = slice.endSample - slice.startSample
    if (runningSamples > 0 && runningSamples + length > maxSamples) {
      batches.push({ fromIndex, toIndex: index })
      fromIndex = index
      runningSamples = 0
    }
    runningSamples += length
  })

  if (fromIndex < slices.length) batches.push({ fromIndex, toIndex: slices.length })

  return batches
}
