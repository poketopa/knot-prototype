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
  '당신은 전사를 읽지 않은 사람도 회의의 논의와 결론을 이해할 수 있게 한국어로 정리합니다.',
  '회의 발언과 구간 메모에 있는 내용만 사용합니다. 회의 이후의 구현 현황이나 외부 지식을 덧붙이지 않습니다.',
  '제안·추측·검토 중인 안과 실제로 합의한 범위를 구별하고, 마지막에 범위가 좁혀졌다면 최종 합의를 우선합니다.',
  '핵심 요약에는 회의의 우선순위와 이번에 합의한 범위를 먼저 적습니다. 중요한 주장은 배경과 이유까지 설명합니다.',
  '이어서 주요 논의마다 구체적인 소제목을 붙이고 논의한 문제, 대안, 판단 이유, 현재 상태를 읽기 쉬운 문단으로 씁니다.',
  '섹션과 문단 수를 고정하지 않습니다. 논의가 많으면 자세히 쓰고, 짧은 회의는 그만큼 간결하게 씁니다. 겹치는 주제와 같은 결론은 합치고 잡담·일반론은 생략합니다.',
  '결정·미결정 목록을 별도로 만들지 말고 필요한 결론은 해당 논의 속에서 설명합니다.',
  '화자 번호는 신원이 아닙니다. 누가 맡기로 했는지가 명확할 때만 참여자 번호를 사용합니다.',
  '아래 형식으로만 출력합니다. ## 핵심 요약 다음에 요약 문단을 쓰고, 이후 ## 로 시작하는 소제목과 본문을 하나 이상 씁니다.'
].join('\n')
const NOTES_SYSTEM = [
  '당신은 회의 전사 구간을 나중에 전체 회의 문서로 합칠 수 있게 메모합니다.',
  '주제마다 문제, 제안한 대안, 이유와 반론, 실제 합의 또는 보류, 맡기로 한 일을 보존합니다.',
  '발언 속 추측과 확인된 사실을 구별하고, 입력에 없는 회의 이후 상황을 만들지 않습니다.',
  '짧다는 이유로 핵심을 생략하지 않되 반복과 잡담은 제외합니다.'
].join('\n')
const INSTRUCTION = [
  '다음 회의 내용으로 한 회의의 정리본을 작성하세요. 분량은 실제 논의의 양에 맞춥니다.',
  '각 주요 논의가 왜 나왔고 무엇을 검토해 어디까지 정했는지 설명하세요. 입력에 근거가 없는 설명으로 분량을 늘리지 마세요.',
  '전사에서 말하지 않은 회의 이후의 변경이나 현재 제품 상태는 넣지 마세요.',
  '',
  '## 핵심 요약',
  '회의의 핵심과 실제 합의 범위를 필요한 만큼의 문장으로 설명합니다.',
  '',
  '## 논의 내용을 나타내는 소제목',
  '해당 논의의 배경, 대안, 이유와 결론을 문단으로 설명합니다. 실제 주제에 맞춰 소제목을 바꿉니다.',
  '',
  '회의 내용:',
  ''
].join('\n')
const NOTES_INSTRUCTION = '다음 회의 구간에서 후속 정리에 필요한 내용을 빠짐없이 메모하세요.\n\n'
const REDUCE_INSTRUCTION =
  '다음은 같은 회의의 앞뒤 구간 메모입니다. 주제별 문제·대안·근거·최종 합의와 보류를 보존하며 합치세요. 짧게 만들기 위해 논의를 삭제하지 마세요.\n\n'
const MEETING_FINAL_MAX_TOKENS = 3000
const MEETING_NOTES_MAX_TOKENS = 1300

/** 과거 분석에도 같은 표시 형식을 적용한다. 빈 분석에는 내용을 만들어 넣지 않는다. */
export const fallbackMeetingSummary = (analysis: {
  topics: ReadonlyArray<{ overview?: string; summarySections?: ReadonlyArray<{ text: string }> }>
}): MeetingSummaryContent => {
  const overviews = analysis.topics
    .map(
      (topic) =>
        topic.overview?.trim() ??
        topic.summarySections?.map((section) => section.text).join(' ') ??
        ''
    )
    .filter(Boolean)
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
  const headings = [...text.matchAll(/^#{2,3}\s+(.+?)\s*$/gm)]
  const first = headings[0]
  const second = headings[1]
  if (
    !first ||
    !second ||
    first.index !== 0 ||
    first[1].trim() !== '핵심 요약' ||
    second[1].trim() === '핵심 요약'
  ) {
    throw new Error('회의 전체 정리 형식이 올바르지 않습니다. 다시 시도해 주세요')
  }
  const headline = text.slice(first[0].length, second.index).trim()
  const body = text.slice(second.index).trim()
  if (!headline || !body.replace(/^#{2,3}\s+.+$/gm, '').trim()) {
    throw new Error('회의 전체 정리 형식이 올바르지 않습니다. 다시 시도해 주세요')
  }
  return {
    schemaVersion: 1,
    headline,
    body
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
  if (analysis.schemaVersion === 2) {
    return analysis.topics.flatMap((topic) => [
      topic.title,
      ...topic.summarySections.map((section) => `${section.heading}: ${section.text}`),
      ...topic.outline.flatMap((section) =>
        section.items.map((item) => `${section.heading}: ${item.text}`)
      )
    ])
  }
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

/** 전사를 우선 읽고, 긴 회의는 구간 메모를 거쳐 주제별 설명으로 합친다. */
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
    (client.provider === 'local'
      ? Math.min(client.chunkBudgetChars, 6000)
      : client.chunkBudgetChars) -
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
          MEETING_NOTES_MAX_TOKENS
        )
      )
    }
    inputs = notes
  }
  let pass = 1
  while (batchesOf(inputs, budget).length > 1) {
    const groups = batchesOf(inputs, budget)
    if (pass > 6) {
      throw new Error(
        '회의 정리의 입력 크기를 줄이지 못했습니다. 구간별 결과는 보관되어 있습니다. 더 큰 입력을 지원하는 AI로 다시 시도해 주세요'
      )
    }
    const previousSize = inputs.join('\n').length
    const notes: string[] = []
    for (const [index, group] of groups.entries()) {
      notes.push(
        await complete(
          `meeting-notes-${pass}-${index}`,
          NOTES_SYSTEM,
          `${REDUCE_INSTRUCTION}중복 표현을 제거하고 ${Math.max(200, Math.floor(budget / (groups.length + 1)))}자 이내로 압축하세요. 중요한 논의의 사실과 이유는 유지하세요.\n\n${group}`,
          MEETING_NOTES_MAX_TOKENS
        )
      )
    }
    if (notes.join('\n').length >= previousSize) {
      throw new Error(
        '회의 정리의 입력 크기를 줄이지 못했습니다. 구간별 결과는 보관되어 있습니다. 더 큰 입력을 지원하는 AI로 다시 시도해 주세요'
      )
    }
    inputs = notes
    pass += 1
  }
  const final = await complete(
    'meeting-final',
    SYSTEM,
    `${INSTRUCTION}${inputs.join('\n\n')}`,
    MEETING_FINAL_MAX_TOKENS
  )
  return {
    content: parseMeetingSummary(final),
    provider: client.provider,
    model: client.model,
    rawResponses
  }
}
