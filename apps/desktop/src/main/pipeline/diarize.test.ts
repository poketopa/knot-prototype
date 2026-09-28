import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildDiarizeArgs, parseDiarizeOutput, parseDiarizeProgress } from './diarize'

// sherpa-onnx v1.13.6 sherpa-onnx-offline-speaker-diarization 실제 stdout 일부
const SAMPLE = readFileSync(path.join(__dirname, 'fixtures/diarizeOutputSample.txt'), 'utf-8')

describe('parseDiarizeOutput', () => {
  it('구간 줄만 골라 화자 구간으로 바꾼다', () => {
    const segments = parseDiarizeOutput(SAMPLE)

    expect(segments).toHaveLength(8)
    expect(segments[0]).toEqual({ start: 0.959, end: 5.178, speaker: 'speaker_01' })
  })

  it('설정 덤프와 Started 같은 잡음 줄은 버린다', () => {
    const segments = parseDiarizeOutput(SAMPLE)

    expect(segments.every((segment) => segment.speaker.startsWith('speaker_'))).toBe(true)
  })

  it('겹치는 구간도 그대로 남긴다', () => {
    const segments = parseDiarizeOutput(SAMPLE)
    const overlapping = segments.filter((segment) => segment.start < 61.3 && segment.end > 57.7)

    expect(overlapping.length).toBeGreaterThan(1)
  })

  it('구간 줄이 하나도 없으면 빈 배열을 반환한다', () => {
    expect(parseDiarizeOutput('Started\n')).toEqual([])
  })
})

describe('parseDiarizeProgress', () => {
  it('진행률 줄에서 퍼센트를 읽는다', () => {
    expect(parseDiarizeProgress('progress 89.35%')).toBeCloseTo(89.35, 2)
  })

  it('진행률 줄이 아니면 null을 반환한다', () => {
    expect(parseDiarizeProgress('Started')).toBeNull()
  })
})

describe('buildDiarizeArgs', () => {
  it('참석자 수를 알면 num-clusters를 쓴다', () => {
    const args = buildDiarizeArgs({
      segmentationModelPath: '/models/seg.onnx',
      embeddingModelPath: '/models/emb.onnx',
      audioPath: '/audio/a.wav',
      threads: 4,
      speakerCount: 3
    })

    expect(args).toContain('--clustering.num-clusters=3')
    expect(args.some((arg) => arg.startsWith('--clustering.cluster-threshold'))).toBe(false)
  })

  it('참석자 수를 모르면 cluster-threshold를 쓴다', () => {
    const args = buildDiarizeArgs({
      segmentationModelPath: '/models/seg.onnx',
      embeddingModelPath: '/models/emb.onnx',
      audioPath: '/audio/a.wav',
      threads: 4,
      clusterThreshold: 0.6
    })

    expect(args).toContain('--clustering.cluster-threshold=0.6')
  })

  it('오디오 경로는 항상 마지막 인자다', () => {
    const args = buildDiarizeArgs({
      segmentationModelPath: '/models/seg.onnx',
      embeddingModelPath: '/models/emb.onnx',
      audioPath: '/audio/a.wav',
      threads: 4
    })

    expect(args.at(-1)).toBe('/audio/a.wav')
  })
})
