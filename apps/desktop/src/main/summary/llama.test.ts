import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { buildSummaryArgs, parseSummaryOutput } from './llama'

// llama.cpp b10622 `llama-cli -st -o` 실제 출력과 그때 넘긴 프롬프트
const SAMPLE = readFileSync(path.join(__dirname, 'fixtures/llamaCliOutput.txt'), 'utf8')
const SAMPLE_PROMPT = readFileSync(path.join(__dirname, 'fixtures/llamaCliPrompt.txt'), 'utf8')

describe('buildSummaryArgs', () => {
  const args = buildSummaryArgs({
    modelPath: '/models/qwen.gguf',
    systemPromptPath: '/work/system.txt',
    promptPath: '/work/prompt.txt',
    outputPath: '/work/out.txt',
    threads: 8
  })

  it('프롬프트와 출력을 파일로 주고받는다', () => {
    expect(args).toContain('-f')
    expect(args[args.indexOf('-f') + 1]).toBe('/work/prompt.txt')
    expect(args[args.indexOf('-sysf') + 1]).toBe('/work/system.txt')
    expect(args[args.indexOf('-o') + 1]).toBe('/work/out.txt')
  })

  it('한 턴만 돌고 끝나도록 단발 모드를 켠다', () => {
    expect(args).toContain('-st')
  })

  it('본문의 역슬래시가 제어문자로 바뀌지 않게 escape를 끈다', () => {
    expect(args).toContain('--no-escape')
  })

  it('컨텍스트·생성 길이·스레드를 숫자 문자열로 넘긴다', () => {
    expect(Number(args[args.indexOf('-c') + 1])).toBeGreaterThan(0)
    expect(Number(args[args.indexOf('-n') + 1])).toBeGreaterThan(0)
    expect(args[args.indexOf('-t') + 1]).toBe('8')
  })
})

describe('parseSummaryOutput', () => {
  it('실제 출력에서 답변만 떼어 낸다', () => {
    const summary = parseSummaryOutput({ raw: SAMPLE, prompt: SAMPLE_PROMPT })

    expect(summary.startsWith('## 핵심 요약')).toBe(true)
    expect(summary).toContain('## 다음 할 일')
    expect(summary).not.toContain('User:')
    expect(summary).not.toContain('회의록 전문입니다')
  })

  it('줄 끝 공백을 걷어낸 상태로 돌려준다', () => {
    const summary = parseSummaryOutput({ raw: SAMPLE, prompt: SAMPLE_PROMPT })

    summary.split('\n').forEach((line) => expect(line).toBe(line.trimEnd()))
  })

  it('회의록 본문에 Assistant 표시가 있어도 답변만 집는다', () => {
    const prompt = '아래는 회의록입니다.\n\n[00:00:01] 화자 1: 그 표시는\nAssistant:\n였습니다.'
    const raw = `User:\n${prompt}\n\nAssistant:\n## 핵심 요약\n- 표시 얘기`

    expect(parseSummaryOutput({ raw, prompt })).toBe('## 핵심 요약\n- 표시 얘기')
  })

  it('형식이 다르면 한국어 오류를 던진다', () => {
    expect(() => parseSummaryOutput({ raw: '알 수 없는 출력', prompt: '프롬프트' })).toThrow(
      /출력 형식/
    )
  })

  it('답변이 비어 있으면 오류를 던진다', () => {
    expect(() =>
      parseSummaryOutput({ raw: 'User:\n어떤 것\n\nAssistant:\n   ', prompt: '어떤 것' })
    ).toThrow(/비어 있습니다/)
  })
})
