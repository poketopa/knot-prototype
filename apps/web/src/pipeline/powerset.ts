/**
 * pyannote/segmentation-3.0의 powerset 출력 디코딩.
 * 모델은 10초 창마다 프레임별로 7클래스 중 하나를 고른다 (config.json의 id2label):
 * 0=무음, 1~3=혼자 말하는 로컬 화자, 4~6=두 명이 동시에 말하는 조합.
 * 여기서 나오는 화자 번호는 **창 안에서만 유효**하다. 창 사이 동일성은 임베딩 군집이 맡는다.
 */

/** 클래스 인덱스 → 그 순간 말하고 있는 로컬 화자 번호들 */
export const POWERSET_CLASSES: readonly (readonly number[])[] = [
  [],
  [0],
  [1],
  [2],
  [0, 1],
  [0, 2],
  [1, 2]
]

/** 한 창에서 구분할 수 있는 로컬 화자 수 */
export const LOCAL_SPEAKER_COUNT = 3

/** 같은 화자의 조각 사이에 이만큼 짧은 공백은 한 구간으로 잇는다 (pyannote의 min_duration_off) */
const MAX_BRIDGED_GAP_SEC = 0.2

export interface LocalSegment {
  /** 창 안에서만 유효한 화자 번호 (0~2) */
  localSpeaker: number
  start: number
  end: number
}

const argmax = (scores: number[]) => {
  let best = 0
  for (let i = 1; i < scores.length; i += 1) {
    if (scores[i] > scores[best]) best = i
  }
  return best
}

interface DecodePowersetParams {
  /** `[프레임][클래스]` 형태의 로짓. softmax는 argmax 결과를 바꾸지 않으므로 생략한다 */
  frameScores: number[][]
  /** 프레임 한 칸의 길이(초) */
  frameSec: number
  /** 이보다 짧은 구간은 임베딩이 불안정해서 버린다 */
  minSegmentSec: number
}

/** 프레임별 powerset 클래스를 로컬 화자별 구간으로 푼다 */
export const decodePowerset = ({
  frameScores,
  frameSec,
  minSegmentSec
}: DecodePowersetParams): LocalSegment[] => {
  const openings = new Array<number>(LOCAL_SPEAKER_COUNT).fill(-1)
  const closings = new Array<number>(LOCAL_SPEAKER_COUNT).fill(-1)
  const segments: LocalSegment[] = []

  const close = (localSpeaker: number) => {
    const start = openings[localSpeaker] * frameSec
    const end = closings[localSpeaker] * frameSec
    if (end - start >= minSegmentSec) segments.push({ localSpeaker, start, end })
    openings[localSpeaker] = -1
    closings[localSpeaker] = -1
  }

  frameScores.forEach((scores, frame) => {
    const active = POWERSET_CLASSES[argmax(scores)]

    for (let speaker = 0; speaker < LOCAL_SPEAKER_COUNT; speaker += 1) {
      if (!active.includes(speaker)) continue

      const isBridged =
        openings[speaker] !== -1 && (frame - closings[speaker]) * frameSec <= MAX_BRIDGED_GAP_SEC
      if (!isBridged && openings[speaker] !== -1) close(speaker)
      if (openings[speaker] === -1) openings[speaker] = frame
      closings[speaker] = frame + 1
    }
  })

  for (let speaker = 0; speaker < LOCAL_SPEAKER_COUNT; speaker += 1) {
    if (openings[speaker] !== -1) close(speaker)
  }

  return segments.toSorted((a, b) => a.start - b.start)
}
