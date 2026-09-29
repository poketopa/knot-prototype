import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { TopicAnalysisResult } from '@shared/types'
import { createLlmClient } from '../llm/provider'
import { prototypeUserRoot } from '../prototype/authState'

export interface MeetingSummaryContent {
  schemaVersion: 1
  headline: string
  body: string
}

const SYSTEM = [
  '당신은 한 회의 전체를 간결한 한국어 글로 정리합니다.',
  '입력에 나온 내용만 사용하고 날짜, 담당자, 결정 또는 결론을 지어내지 않습니다.',
  '주제별 문서 목록이나 결정/미결정 항목 목록을 출력하지 않습니다.',
  '첫 줄은 "핵심: "으로 시작하는 한 문장, 둘째 줄은 "정리: "로 시작하는 2~4문장입니다.'
].join('\n')
const INSTRUCTION =
  '다음은 회의 전사를 분석한 내용입니다. 회의 전체의 핵심과 흐름을 짧게 정리하세요.\n\n'
const REDUCE_INSTRUCTION =
  '다음은 같은 회의의 앞뒤 구간을 요약한 글입니다. 모든 구간을 고려해 회의 전체를 한 글로 정리하세요.\n\n'

/** 과거 분석에도 같은 표시 형식을 적용한다. 빈 분석에는 내용을 만들어 넣지 않는다. */
export const fallbackMeetingSummary = (analysis: {
  topics: ReadonlyArray<{ overview: string }>
}): MeetingSummaryContent => {
  const overviews = analysis.topics.map((topic) => topic.overview.trim()).filter(Boolean)
  return {
    schemaVersion: 1,
    headline: overviews[0] ?? '',
    body: overviews.join(' ')
  }
}

export const parseMeetingSummary = (raw: string): MeetingSummaryContent => {
  const text = raw
    .trim()
    .replace(/^```(?:text|markdown)?\s*\n|\n```$/g, '')
    .trim()
  if (!text) throw new Error('회의 전체 정리가 비어 있습니다')
  const headlineMatch = text.match(/^핵심\s*:\s*(.+)$/m)
  const bodyMatch = text.match(/^정리\s*:\s*([\s\S]+)$/m)
  if (!headlineMatch || !bodyMatch || !headlineMatch[1].trim() || !bodyMatch[1].trim()) {
    throw new Error('회의 전체 정리 형식이 올바르지 않습니다. 다시 시도해 주세요')
  }
  return {
    schemaVersion: 1,
    headline: headlineMatch[1].trim(),
    body: bodyMatch[1].trim()
  }
}

const sourceLines = (analysis: TopicAnalysisResult) =>
  analysis.topics.flatMap((topic) => [
    `${topic.title}: ${topic.overview}`,
    ...topic.decisions.map((point) => `논의 내용: ${point.text}`),
    ...topic.unresolved.map((point) => `남은 질문: ${point.text}`)
  ])

const splitLongLines = (lines: string[], budget: number) =>
  lines.flatMap((line) => {
    const parts: string[] = []
    for (let offset = 0; offset < line.length; offset += budget) {
      parts.push(line.slice(offset, offset + budget))
    }
    return parts
  })

const batchesOf = (lines: string[], budget: number) => {
  const batches: string[] = []
  let current = ''
  for (const line of splitLongLines(lines, budget)) {
    if (current && current.length + line.length + 1 > budget) {
      batches.push(current)
      current = ''
    }
    current += `${current ? '\n' : ''}${line}`
  }
  if (current) batches.push(current)
  return batches
}

/** 새 녹음은 전사 기반 분석을 다시 읽어 회의 전체의 한 문장 핵심과 짧은 글을 만든다. */
export const createMeetingSummary = async ({
  recordingId,
  analysis
}: {
  recordingId: string
  analysis: TopicAnalysisResult
}) => {
  if (!analysis.topics.length) {
    return {
      content: fallbackMeetingSummary(analysis),
      provider: 'local' as const,
      model: null,
      rawResponses: [] as Array<{ label: string; text: string }>
    }
  }

  const client = await createLlmClient()
  const budget =
    Math.min(client.chunkBudgetChars, 6000) -
    SYSTEM.length -
    Math.max(INSTRUCTION.length, REDUCE_INSTRUCTION.length) -
    128
  if (budget < 400) throw new Error('현재 AI 모델에 회의 전체 정리를 만들 입력 공간이 부족합니다')
  const workDir = path.join(prototypeUserRoot(), 'meeting-summaries', recordingId, randomUUID())
  await mkdir(workDir, { recursive: true })
  const rawResponses: Array<{ label: string; text: string }> = []
  let inputs = batchesOf(sourceLines(analysis), budget)
  let pass = 0
  while (inputs.length) {
    const next: string[] = []
    const groups = batchesOf(inputs, budget)
    if (pass > 0 && groups.length >= inputs.length && inputs.length > 1) {
      throw new Error('회의 전체 정리를 합칠 수 없습니다. 구간별 AI 결과는 보관되어 있습니다')
    }
    for (const [index, group] of groups.entries()) {
      const label = `meeting-${pass}-${index}`
      const prompt = `${pass === 0 ? INSTRUCTION : REDUCE_INSTRUCTION}${group}`
      const raw = await client.complete({
        system: SYSTEM,
        prompt,
        maxTokens: 550,
        label,
        workDir,
        temperature: 0
      })
      await writeFile(path.join(workDir, `${label}.raw.txt`), raw, { flag: 'wx' })
      rawResponses.push({ label, text: raw })
      next.push(raw.trim())
    }
    if (next.length === 1) {
      return {
        content: parseMeetingSummary(next[0]),
        provider: client.provider,
        model: client.model,
        rawResponses
      }
    }
    inputs = next
    pass += 1
  }
  throw new Error('회의 전체 정리를 만들 내용이 없습니다')
}
