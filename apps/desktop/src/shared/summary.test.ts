import { describe, expect, it } from 'vitest'

import {
  buildChunkPrompt,
  buildReducePrompt,
  buildWholePrompt,
  CHUNK_BUDGET_CHARS,
  cleanSummary,
  estimateTokens,
  splitTranscript,
  SUMMARY_CTX_TOKENS,
  SUMMARY_MAX_PREDICT_TOKENS
} from './summary'

const line = (index: number) => `[00:0${index}:00] 화자 1: 배포 일정을 정리하겠습니다.`

describe('splitTranscript', () => {
  it('예산 안에 들어오면 한 구간으로 둔다', () => {
    const text = [line(1), line(2), line(3)].join('\n')

    expect(splitTranscript({ text })).toEqual([text])
  })

  it('빈 회의록은 빈 배열이다', () => {
    expect(splitTranscript({ text: '' })).toEqual([])
    expect(splitTranscript({ text: '\n\n  \n' })).toEqual([])
  })

  it('예산을 넘으면 줄 경계에서만 자른다', () => {
    const text = [line(1), line(2), line(3), line(4)].join('\n')
    const chunks = splitTranscript({ text, budgetChars: line(1).length * 2 + 2 })

    expect(chunks).toHaveLength(2)
    chunks.forEach((chunk) => {
      chunk.split('\n').forEach((each) => expect(each).toMatch(/^\[00:\d{2}:00\]/))
    })
  })

  it('구간을 이어 붙이면 원본 줄이 순서대로 모두 남는다', () => {
    const lines = Array.from({ length: 9 }, (_, index) => line(index))
    const chunks = splitTranscript({ text: lines.join('\n'), budgetChars: line(0).length * 3 })

    expect(chunks.join('\n').split('\n')).toEqual(lines)
  })

  it('한 줄이 예산보다 길어도 잘라 버리지 않는다', () => {
    const long = `[00:00:00] 화자 1: ${'가'.repeat(100)}`
    const chunks = splitTranscript({ text: long, budgetChars: 10 })

    expect(chunks).toEqual([long])
  })

  it('기본 예산은 컨텍스트에 출력 몫을 남긴다', () => {
    // 프롬프트가 컨텍스트를 넘으면 뒷부분이 조용히 잘린 채로 요약된다
    expect(CHUNK_BUDGET_CHARS).toBeGreaterThan(1000)
    expect(estimateTokens({ chars: CHUNK_BUDGET_CHARS }) + SUMMARY_MAX_PREDICT_TOKENS).toBeLessThan(
      SUMMARY_CTX_TOKENS
    )
  })
})

describe('buildWholePrompt', () => {
  it('회의록 본문과 최종 형식을 함께 담는다', () => {
    const prompt = buildWholePrompt({ transcript: line(1) })

    expect(prompt).toContain(line(1))
    expect(prompt).toContain('## 핵심 요약')
    expect(prompt).toContain('## 결정 사항')
    expect(prompt).toContain('## 다음 할 일')
  })
})

describe('buildChunkPrompt', () => {
  it('구간 번호를 1부터 세어 알려 준다', () => {
    const prompt = buildChunkPrompt({ chunk: line(1), index: 0, total: 5 })

    expect(prompt).toContain('5개 구간 중 1번째')
    expect(prompt).toContain(line(1))
  })

  it('부분 요약 형식을 쓰고 최종 형식은 쓰지 않는다', () => {
    const prompt = buildChunkPrompt({ chunk: line(1), index: 2, total: 5 })

    expect(prompt).toContain('## 논의')
    expect(prompt).not.toContain('## 핵심 요약')
  })
})

describe('buildReducePrompt', () => {
  it('부분 요약을 순서대로 담고 최종 형식을 요구한다', () => {
    const prompt = buildReducePrompt({ partials: ['## 논의\n- 첫째', '## 논의\n- 둘째'] })

    expect(prompt.indexOf('첫째')).toBeLessThan(prompt.indexOf('둘째'))
    expect(prompt).toContain('### 구간 1')
    expect(prompt).toContain('### 구간 2')
    expect(prompt).toContain('## 핵심 요약')
  })
})

describe('cleanSummary', () => {
  it('앞뒤 공백과 줄 끝 공백을 지운다', () => {
    expect(cleanSummary('  ## 핵심 요약  \n- 배포 연기  \n\n')).toBe('## 핵심 요약\n- 배포 연기')
  })

  it('코드펜스로 감싼 출력을 벗긴다', () => {
    expect(cleanSummary('```markdown\n## 핵심 요약\n- 배포 연기\n```')).toBe(
      '## 핵심 요약\n- 배포 연기'
    )
  })

  it('빈 줄이 세 줄 이상 이어지면 두 줄로 줄인다', () => {
    expect(cleanSummary('## 핵심 요약\n\n\n\n- 배포 연기')).toBe('## 핵심 요약\n\n- 배포 연기')
  })

  it('본문 안의 코드펜스는 건드리지 않는다', () => {
    const raw = '## 핵심 요약\n- 다음 명령을 쓴다\n```sh\npnpm dev\n```\n- 끝'

    expect(cleanSummary(raw)).toBe(raw)
  })
})
