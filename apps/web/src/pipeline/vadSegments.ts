/**
 * silero VAD 확률열을 발화 구간으로 바꾸는 후처리.
 * 임계값·최소 길이는 whisper.cpp의 `--vad` 기본값을 그대로 옮겼다. 데스크탑과 같은 구간이 나와야
 * 브라우저 결과를 데스크탑 결과와 비교할 수 있다.
 */

/** 이 확률 이상이면 발화 시작 */
const SPEECH_START_THRESHOLD = 0.5
/** 한 번 시작한 발화는 이 확률 밑으로 떨어져야 끝난다 (silero VADIterator의 threshold - 0.15) */
const SPEECH_END_THRESHOLD = 0.35
/** 이보다 짧은 발화는 버린다 */
const MIN_SPEECH_SEC = 0.25
/** 이보다 짧은 침묵은 발화 중간으로 본다 */
const MIN_SILENCE_SEC = 0.1
/** 구간 앞뒤로 붙이는 여유. 첫 음절이 잘리면 Whisper가 단어를 통째로 놓친다 */
const SPEECH_PAD_SEC = 0.03

export interface SpeechRegion {
  start: number
  end: number
}

const mergeOverlapping = (regions: SpeechRegion[]) =>
  regions
    .toSorted((a, b) => a.start - b.start)
    .reduce<SpeechRegion[]>((merged, region) => {
      const last = merged.at(-1)
      if (!last || region.start > last.end) return [...merged, region]

      return merged.with(merged.length - 1, {
        start: last.start,
        end: Math.max(last.end, region.end)
      })
    }, [])

interface BuildSpeechRegionsParams {
  /** 창마다 나온 발화 확률 */
  probabilities: number[]
  /** 창 하나의 길이(초) */
  windowSec: number
  /** 전체 오디오 길이(초) */
  totalSec: number
}

/** 발화 확률열 → 앞뒤 여유가 붙고 겹침이 정리된 발화 구간 */
export const buildSpeechRegions = ({
  probabilities,
  windowSec,
  totalSec
}: BuildSpeechRegionsParams) => {
  const regions: SpeechRegion[] = []
  let speechStart = -1
  let silenceStart = -1

  const closeAt = (end: number) => {
    if (end - speechStart >= MIN_SPEECH_SEC) regions.push({ start: speechStart, end })
    speechStart = -1
    silenceStart = -1
  }

  probabilities.forEach((probability, index) => {
    const time = index * windowSec

    if (speechStart === -1) {
      if (probability >= SPEECH_START_THRESHOLD) speechStart = time
      return
    }
    if (probability >= SPEECH_END_THRESHOLD) {
      silenceStart = -1
      return
    }
    if (silenceStart === -1) {
      silenceStart = time
      return
    }
    if (time - silenceStart >= MIN_SILENCE_SEC) closeAt(silenceStart)
  })

  if (speechStart !== -1) closeAt(totalSec)

  return mergeOverlapping(
    regions.map((region) => ({
      start: Math.max(0, region.start - SPEECH_PAD_SEC),
      end: Math.min(totalSec, region.end + SPEECH_PAD_SEC)
    }))
  )
}

/** 발화 구간의 총 길이(초) */
export const totalSpeechSec = (regions: SpeechRegion[]) =>
  regions.reduce((total, region) => total + region.end - region.start, 0)
