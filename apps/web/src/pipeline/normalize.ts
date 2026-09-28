/**
 * STT 전에 음량을 맞추는 RMS 게인 정규화. 데스크탑은 16bit PCM WAV 버퍼를 읽고 쓰지만
 * 브라우저에서는 이미 디코딩된 `Float32Array`를 제자리에서 고치므로 루프만 따로 갖는다.
 * 목표 음량·게인 상한·프레임 길이는 `@meeting-stt/core/normalize`에서 가져와
 * 데스크탑과 같은 dBFS·게인 값이 나오게 한다 (docs/phase1-results.md).
 */

import { frameSamplesOf, gainDbFor, gainOf, speechRmsDbOf } from '@meeting-stt/core/normalize'

const FULL_SCALE = 1

interface MeasureSpeechRmsDbParams {
  samples: Float32Array
  sampleRate: number
}

/** 발화 구간의 대표 음량(dBFS). 무음뿐이면 -Infinity */
export const measureSpeechRmsDb = ({ samples, sampleRate }: MeasureSpeechRmsDbParams) => {
  const frameSamples = frameSamplesOf({ sampleRate })
  const frameRms: number[] = []

  for (let start = 0; start + frameSamples <= samples.length; start += frameSamples) {
    let sumSquares = 0
    for (let i = start; i < start + frameSamples; i += 1) {
      sumSquares += samples[i] * samples[i]
    }
    frameRms.push(Math.sqrt(sumSquares / frameSamples))
  }

  return speechRmsDbOf({ frameRms })
}

/**
 * 게인을 **제자리에서** 적용하고 ±1을 넘는 샘플은 하드 클립한다.
 * 71분 16kHz면 배열 하나가 273MB라 복사본을 만들면 피크 메모리가 두 배가 된다.
 */
export const applyGainInPlace = ({
  samples,
  gainDb
}: {
  samples: Float32Array
  gainDb: number
}) => {
  const gain = gainOf(gainDb)
  let clippedCount = 0

  for (let i = 0; i < samples.length; i += 1) {
    const scaled = samples[i] * gain
    if (scaled > FULL_SCALE || scaled < -FULL_SCALE) clippedCount += 1
    samples[i] = Math.max(-FULL_SCALE, Math.min(FULL_SCALE, scaled))
  }

  return clippedCount
}

export interface NormalizeResult {
  speechRmsDb: number
  gainDb: number
  clippedRatio: number
  normalizedSpeechRmsDb: number
}

/** 샘플 배열을 제자리에서 정규화하고 측정값을 돌려준다 */
export const normalizeSamples = ({ samples, sampleRate }: MeasureSpeechRmsDbParams) => {
  const speechRmsDb = measureSpeechRmsDb({ samples, sampleRate })
  const gainDb = gainDbFor(speechRmsDb)
  const clippedCount = applyGainInPlace({ samples, gainDb })

  const result: NormalizeResult = {
    speechRmsDb,
    gainDb,
    clippedRatio: samples.length === 0 ? 0 : clippedCount / samples.length,
    normalizedSpeechRmsDb: measureSpeechRmsDb({ samples, sampleRate })
  }

  return result
}
