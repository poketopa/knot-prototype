/**
 * 화자 분리 결과를 정답 타임라인과 비교한다.
 * 클러스터 번호는 정답의 화자 이름과 임의로 대응되므로, 가장 잘 맞는 대응을 찾아 정확도를 낸다.
 * 프로토타입이 "주요 화자가 구분되는가"를 숫자로 보기 위한 것이다 (docs/browser-prototype-plan.md §1).
 */

import type { SpeakerSegment } from '@meeting-stt/core/types'

const FRAME_SEC = 0.1

export interface ReferenceTurn {
  speaker: string
  startSec: number
  endSec: number
}

/** 프레임마다 그 시각을 덮는 구간의 화자. 없으면 null */
const toFrameLabels = <TSegment>({
  segments,
  frameCount,
  startOf,
  endOf,
  labelOf
}: {
  segments: TSegment[]
  frameCount: number
  startOf: (segment: TSegment) => number
  endOf: (segment: TSegment) => number
  labelOf: (segment: TSegment) => string
}) => {
  const labels = new Array<string | null>(frameCount).fill(null)

  for (const segment of segments) {
    const from = Math.max(0, Math.round(startOf(segment) / FRAME_SEC))
    const to = Math.min(frameCount, Math.round(endOf(segment) / FRAME_SEC))
    for (let frame = from; frame < to; frame += 1) labels[frame] = labelOf(segment)
  }

  return labels
}

/** 모든 대응 중 가장 많이 맞는 것을 고른다. 화자 수가 적어 전수 탐색으로 충분하다 */
const bestMapping = ({
  counts,
  predictedLabels,
  referenceLabels
}: {
  counts: Map<string, Map<string, number>>
  predictedLabels: string[]
  referenceLabels: string[]
}) => {
  const permute = (remaining: string[]): string[][] =>
    remaining.length === 0
      ? [[]]
      : remaining.flatMap((label, index) =>
          permute(remaining.toSpliced(index, 1)).map((rest) => [label, ...rest])
        )

  const [shorter, longer] =
    predictedLabels.length <= referenceLabels.length
      ? [predictedLabels, referenceLabels]
      : [referenceLabels, predictedLabels]
  const isPredictedShorter = predictedLabels.length <= referenceLabels.length

  let best = 0
  for (const candidate of permute(longer)) {
    let matched = 0
    shorter.forEach((label, index) => {
      const [predicted, reference] = isPredictedShorter
        ? [label, candidate[index]]
        : [candidate[index], label]
      matched += counts.get(predicted)?.get(reference) ?? 0
    })
    if (matched > best) best = matched
  }

  return best
}

interface MeasureParams {
  speakerSegments: SpeakerSegment[]
  reference: ReferenceTurn[]
  durationSec: number
}

/** 정답이 화자를 지정한 프레임 중 몇 퍼센트를 맞췄는지 */
export const measureDiarizationAccuracy = ({
  speakerSegments,
  reference,
  durationSec
}: MeasureParams) => {
  const frameCount = Math.ceil(durationSec / FRAME_SEC)
  const predicted = toFrameLabels({
    segments: speakerSegments,
    frameCount,
    startOf: (segment) => segment.start,
    endOf: (segment) => segment.end,
    labelOf: (segment) => segment.speaker
  })
  const referenceFrames = toFrameLabels({
    segments: reference,
    frameCount,
    startOf: (turn) => turn.startSec,
    endOf: (turn) => turn.endSec,
    labelOf: (turn) => turn.speaker
  })

  const counts = new Map<string, Map<string, number>>()
  let scoredFrames = 0

  for (let frame = 0; frame < frameCount; frame += 1) {
    const truth = referenceFrames[frame]
    if (truth === null) continue

    scoredFrames += 1
    const guess = predicted[frame]
    if (guess === null) continue

    const row = counts.get(guess) ?? new Map<string, number>()
    row.set(truth, (row.get(truth) ?? 0) + 1)
    counts.set(guess, row)
  }

  const matched = bestMapping({
    counts,
    predictedLabels: [...new Set(speakerSegments.map((segment) => segment.speaker))],
    referenceLabels: [...new Set(reference.map((turn) => turn.speaker))]
  })

  return {
    accuracy: scoredFrames === 0 ? 0 : matched / scoredFrames,
    scoredSec: scoredFrames * FRAME_SEC,
    predictedSpeakerCount: new Set(speakerSegments.map((segment) => segment.speaker)).size,
    referenceSpeakerCount: new Set(reference.map((turn) => turn.speaker)).size
  }
}
