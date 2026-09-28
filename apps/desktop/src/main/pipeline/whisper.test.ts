import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildWhisperArgs, parseWhisperOutput, parseWhisperProgress } from './whisper'

// whisper-cpp 1.8.4 `--output-json-full --vad` 실제 출력에서 3개 세그먼트만 잘라낸 샘플
const SAMPLE = readFileSync(path.join(__dirname, 'fixtures/whisperOutputSample.json'))
// 같은 구간을 `-nfa -dtw large.v3.turbo`로 다시 돌린 샘플
const DTW_SAMPLE = readFileSync(path.join(__dirname, 'fixtures/whisperDtwOutputSample.json'))

describe('parseWhisperOutput', () => {
  it('토큰이 쪼갠 한글을 원래 문장으로 복원한다', () => {
    const segments = parseWhisperOutput(SAMPLE)

    expect(segments).toHaveLength(3)
    expect(segments[1].text).toBe(
      '다만 QA에서 결제 모듈 이슈가 하나 남아 있어서 확답은 어렵습니다.'
    )
  })

  it('세그먼트 시간은 초 단위로 바꾼다', () => {
    const segments = parseWhisperOutput(SAMPLE)

    expect(segments[0].start).toBeCloseTo(10.64, 3)
    expect(segments[0].end).toBeCloseTo(16.15, 3)
  })

  it('단어 단위 타임스탬프를 만든다', () => {
    const [segment] = parseWhisperOutput(SAMPLE)

    expect(segment.words?.length).toBeGreaterThan(3)
    expect(segment.words?.[0].text).toBe('배포')
  })

  it('VAD 때문에 어긋난 토큰 시간을 세그먼트 구간 안으로 되돌린다', () => {
    const segments = parseWhisperOutput(SAMPLE)

    for (const segment of segments) {
      const words = segment.words ?? []
      expect(words[0].start).toBeGreaterThanOrEqual(segment.start)
      expect(words.at(-1)?.end).toBeLessThanOrEqual(segment.end)
    }
  })

  it('세그먼트 끝에 맞춰 되돌리므로 첫 단어가 세그먼트 시작에 붙지 않는다', () => {
    // 세그먼트의 from은 직전 세그먼트의 to를 그대로 쓴 값이라 실제 발화 시작보다 이르다
    const segments = parseWhisperOutput(DTW_SAMPLE)
    const [first] = segments

    expect(first.words?.[0].start).toBeGreaterThan(first.start)
    expect(first.words?.at(-1)?.end).toBeCloseTo(first.end, 3)
  })

  it('[_TT_...] 같은 특수 토큰은 본문에 넣지 않는다', () => {
    const segments = parseWhisperOutput(SAMPLE)

    expect(segments.some((segment) => segment.text.includes('[_'))).toBe(false)
  })

  it('DTW 샘플에서도 같은 문장을 복원한다', () => {
    const segments = parseWhisperOutput(DTW_SAMPLE)

    expect(segments[1].text).toBe(
      '다만 QA에서 결제 모듈 이슈가 하나 남아 있어서 확답은 어렵습니다.'
    )
  })

  it('DTW 토큰 시각(10ms 단위)을 세그먼트 구간 안으로 되돌린다', () => {
    const segments = parseWhisperOutput(DTW_SAMPLE)

    for (const segment of segments) {
      const words = segment.words ?? []
      expect(words[0].start).toBeGreaterThanOrEqual(segment.start)
      expect(words.at(-1)?.end).toBeLessThanOrEqual(segment.end)
    }
  })

  it('JSON이 아니면 무엇이 잘못됐는지 알리며 실패한다', () => {
    expect(() => parseWhisperOutput(Buffer.from('not json'))).toThrow(/whisper/)
  })

  it('transcription이 없으면 실패한다', () => {
    expect(() => parseWhisperOutput(Buffer.from('{"result":{}}'))).toThrow(/whisper/)
  })
})

describe('parseWhisperProgress', () => {
  it('진행률 로그에서 퍼센트를 읽는다', () => {
    expect(parseWhisperProgress('whisper_print_progress_callback: progress =  27%')).toBe(27)
  })

  it('진행률 로그가 아니면 null을 반환한다', () => {
    expect(parseWhisperProgress('load_backend: loaded MTL backend')).toBeNull()
  })
})

describe('buildWhisperArgs', () => {
  it('한국어·단어 타임스탬프·VAD 옵션을 붙인다', () => {
    const args = buildWhisperArgs({
      modelPath: '/models/ggml.bin',
      audioPath: '/audio/a.wav',
      outputPath: '/out/a',
      vadModelPath: '/models/vad.bin',
      threads: 8
    })

    expect(args).toContain('--output-json-full')
    expect(args.join(' ')).toContain('-l ko')
    expect(args.join(' ')).toContain('--vad --vad-model /models/vad.bin')
  })

  it('DTW를 켜면 flash attention을 함께 끈다', () => {
    const args = buildWhisperArgs({
      modelPath: '/models/ggml.bin',
      audioPath: '/audio/a.wav',
      outputPath: '/out/a',
      threads: 8,
      dtwPreset: 'large.v3.turbo'
    })

    expect(args.join(' ')).toContain('--no-flash-attn -dtw large.v3.turbo')
  })

  it('VAD 모델이 없으면 VAD 옵션을 넣지 않는다', () => {
    const args = buildWhisperArgs({
      modelPath: '/models/ggml.bin',
      audioPath: '/audio/a.wav',
      outputPath: '/out/a',
      threads: 4
    })

    expect(args).not.toContain('--vad')
  })
})
