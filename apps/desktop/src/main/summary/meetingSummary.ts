import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { TopicAnalysisResult } from '@shared/types'
import { SUMMARY_MAX_PREDICT_TOKENS } from '@shared/summary'
import { createLlmClient } from '../llm/provider'
import { prototypeUserRoot } from '../prototype/authState'

export interface MeetingSummaryContent {
  schemaVersion: 1
  headline: string
  body: string
}

const SYSTEM = [
  '당신은 한 회의 전체를 읽기 쉬운 한국어 글로 정리합니다.',
  '입력에 나온 사실만 사용하고 날짜, 담당자, 결정 또는 결론을 지어내지 않습니다.',
  '핵심적인 논의와 그 배경, 의견이 바뀐 이유, 남은 맥락을 중요도에 따라 담습니다.',
  '중요한 내용을 빠뜨리지 않되 같은 말을 반복하지 않습니다. 분량과 문단 수는 내용에 맞게 정합니다.',
  '주제별 문서, 결정/미결정 목록, 불릿 목록을 만들지 않습니다.',
  '첫 줄은 "핵심: "으로 시작하는 한 문장입니다. 이어서 "정리: "로 시작하는 자연스러운 글을 씁니다.'
].join('\n')
const NOTES_SYSTEM = [
  '당신은 회의 전사 구간의 내용을 다음 단계에 전달할 메모로 압축합니다.',
  '논의의 순서와 이유, 중요한 사실 및 반론을 보존합니다. 입력에 없는 내용을 만들지 않습니다.',
  '짧다는 이유로 핵심을 생략하지 않되 반복과 잡담은 제외합니다.'
].join('\n')
const INSTRUCTION = '다음 회의 내용을 전체 회의의 핵심 요약과 읽기 쉬운 글로 정리하세요.\n\n'
const NOTES_INSTRUCTION = '다음 회의 구간에서 후속 정리에 필요한 내용을 빠짐없이 메모하세요.\n\n'
const REDUCE_INSTRUCTION =
  '다음은 같은 회의의 앞뒤 구간 메모입니다. 논의 흐름과 중요한 근거를 보존하며 합치세요.\n\n'

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

type SummaryUtterance = { speakerLabel: string; startSec: number; text: string }

const sourceLines = (analysis: TopicAnalysisResult, utterances: SummaryUtterance[]) => {
  const transcript = utterances
    .filter((utterance) => utterance.text.trim())
    .map(
      (utterance) =>
        `[${Math.floor(utterance.startSec / 60)}분] ${utterance.speakerLabel}: ${utterance.text.trim()}`
    )
  if (transcript.length) return transcript
  return analysis.topics.flatMap((topic) => [
    `${topic.title}: ${topic.overview}`,
    ...topic.decisions.map((point) => `논의 내용: ${point.text}`),
    ...topic.unresolved.map((point) => `남은 질문: ${point.text}`)
  ])
}

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

/** 전사를 우선 읽고, 긴 회의는 구간 메모를 거쳐 한 편의 글로 합친다. */
export const createMeetingSummary = async ({
  recordingId,
  analysis,
  utterances = []
}: {
  recordingId: string
  analysis: TopicAnalysisResult
  utterances?: SummaryUtterance[]
}) => {
  const lines = sourceLines(analysis, utterances)
  if (!lines.length) {
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
    Math.max(SYSTEM.length, NOTES_SYSTEM.length) -
    Math.max(INSTRUCTION.length, NOTES_INSTRUCTION.length, REDUCE_INSTRUCTION.length) -
    128
  if (budget < 400) throw new Error('현재 AI 모델에 회의 전체 정리를 만들 입력 공간이 부족합니다')
  const workDir = path.join(prototypeUserRoot(), 'meeting-summaries', recordingId, randomUUID())
  await mkdir(workDir, { recursive: true })
  const rawResponses: Array<{ label: string; text: string }> = []
  const complete = async (label: string, system: string, prompt: string, maxTokens: number) => {
    const raw = await client.complete({ system, prompt, maxTokens, label, workDir, temperature: 0 })
    await writeFile(path.join(workDir, `${label}.raw.txt`), raw, { flag: 'wx' })
    rawResponses.push({ label, text: raw })
    if (!raw.trim()) throw new Error('회의 전체 정리의 구간 메모가 비어 있습니다')
    return raw.trim()
  }

  let inputs = batchesOf(lines, budget)
  if (inputs.length > 1) {
    const notes: string[] = []
    for (const [index, group] of inputs.entries()) {
      notes.push(
        await complete(
          `meeting-notes-0-${index}`,
          NOTES_SYSTEM,
          `${NOTES_INSTRUCTION}${group}`,
          900
        )
      )
    }
    inputs = notes
  }
  let pass = 1
  while (batchesOf(inputs, budget).length > 1) {
    const groups = batchesOf(inputs, budget)
    if (groups.length >= inputs.length) {
      throw new Error('회의 전체 정리를 합칠 수 없습니다. 구간별 AI 결과는 보관되어 있습니다')
    }
    const notes: string[] = []
    for (const [index, group] of groups.entries()) {
      notes.push(
        await complete(
          `meeting-notes-${pass}-${index}`,
          NOTES_SYSTEM,
          `${REDUCE_INSTRUCTION}${group}`,
          900
        )
      )
    }
    inputs = notes
    pass += 1
  }
  const final = await complete(
    'meeting-final',
    SYSTEM,
    `${INSTRUCTION}${inputs.join('\n\n')}`,
    SUMMARY_MAX_PREDICT_TOKENS
  )
  return {
    content: parseMeetingSummary(final),
    provider: client.provider,
    model: client.model,
    rawResponses
  }
}
