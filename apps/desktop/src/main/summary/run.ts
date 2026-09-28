import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import {
  buildChunkPrompt,
  buildReducePrompt,
  buildTopicChunkPrompt,
  buildTopicReducePrompt,
  buildTopicWholePrompt,
  buildWholePrompt,
  cleanSummary,
  assertTopicCatalogFits,
  parseTopicAnalysis,
  splitTranscript,
  splitTopicAnalysisUtterances,
  SUMMARY_MAX_PREDICT_TOKENS,
  SUMMARY_SYSTEM_PROMPT,
  TOPIC_ANALYSIS_PROMPT_VERSION,
  TOPIC_ANALYSIS_SYSTEM_PROMPT
} from '@shared/summary'
import type {
  SummaryStage,
  TopicAnalysisAttempt,
  TopicAnalysisDocument,
  TopicAnalysisResult,
  TopicAnalysisUtterance
} from '@shared/types'
import { createLlmClient } from '../llm/provider'
import type { LlmClient } from '../llm/types'
import { BinaryExecutionError } from '../bin/spawn'
import { info, messageOf } from '../log'
import { prototypeUserRoot } from '../prototype/authState'

import { summaryWorkDir } from './paths'

/** 구간 요약(map)이 전체 진행률에서 차지하는 몫. 나머지는 합치기(reduce) */
const MAP_PERCENT = 80

interface ProgressParams {
  stage: SummaryStage
  percent: number
}

interface RunSummaryParams {
  meetingId: string
  transcript: string
  onProgress: (progress: ProgressParams) => void
}

interface RunTopicAnalysisParams {
  meetingId: string
  utterances: TopicAnalysisUtterance[]
  documents: TopicAnalysisDocument[]
  onProgress: (progress: ProgressParams) => void
}

interface CompleteParams {
  client: LlmClient
  workDir: string
  prompt: string
  label: string
}

/** 공급자에 한 번 물어 정리한 요약을 돌려준다. 빈 답변은 저장하지 않는다 */
const complete = async ({ client, workDir, prompt, label }: CompleteParams) => {
  const summary = cleanSummary(
    await client.complete({
      system: SUMMARY_SYSTEM_PROMPT,
      prompt,
      maxTokens: SUMMARY_MAX_PREDICT_TOKENS,
      label,
      workDir
    })
  )
  if (!summary) throw new Error('요약이 비어 있습니다 (회의록이 너무 짧을 수 있습니다)')

  return summary
}

interface ReduceParams {
  client: LlmClient
  chunks: string[]
  workDir: string
  onProgress: (progress: ProgressParams) => void
}

/** 구간마다 부분 요약을 만든 뒤 하나로 합친다. 한 번에 하나씩만 돌린다 */
const mapReduce = async ({ client, chunks, workDir, onProgress }: ReduceParams) => {
  const partials: string[] = []

  for (const [index, chunk] of chunks.entries()) {
    onProgress({ stage: 'summarize', percent: (index / chunks.length) * MAP_PERCENT })
    partials.push(
      await complete({
        client,
        workDir,
        prompt: buildChunkPrompt({ chunk, index, total: chunks.length }),
        label: `chunk-${index}`
      })
    )
  }

  onProgress({ stage: 'reduce', percent: MAP_PERCENT })

  return complete({ client, workDir, prompt: buildReducePrompt({ partials }), label: 'reduce' })
}

/**
 * 회의록 텍스트 한 개를 요약문으로 바꾼다. 공급자의 청크 예산에 다 들어가면 한 번에 요약하고,
 * 넘치면 구간별 부분 요약 → 합치기(map-reduce)로 처리한다 (references/architecture.md).
 * 공급자는 잡이 시작할 때 설정에서 한 번 읽는다.
 */
export const runSummary = async ({ meetingId, transcript, onProgress }: RunSummaryParams) => {
  const client = await createLlmClient()

  const chunks = splitTranscript({ text: transcript, budgetChars: client.chunkBudgetChars })
  if (!chunks.length) throw new Error('요약할 회의록이 없습니다')

  const workDir = summaryWorkDir({ meetingId })
  await mkdir(workDir, { recursive: true })
  info(
    `회의 ${meetingId} 요약 시작 (${client.provider}, ${transcript.length}자, 구간 ${chunks.length}개)`
  )

  if (chunks.length === 1) {
    onProgress({ stage: 'summarize', percent: 0 })

    return complete({
      client,
      workDir,
      prompt: buildWholePrompt({ transcript: chunks[0] }),
      label: 'whole'
    })
  }

  return mapReduce({ client, chunks, workDir, onProgress })
}

const writeJson = async ({ file, value }: { file: string; value: unknown }) =>
  writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })

const createAttemptDir = async ({
  meetingId,
  attemptId
}: {
  meetingId: string
  attemptId: string
}) => {
  const baseDir = path.join(prototypeUserRoot(), 'ai-attempts', meetingId)
  await mkdir(baseDir, { recursive: true })
  const attemptDir = path.join(baseDir, `topic-${attemptId}`)
  await mkdir(attemptDir)

  return attemptDir
}

interface CompleteTopicParams {
  client: LlmClient
  workDir: string
  prompt: string
  label: string
  utterances: TopicAnalysisUtterance[]
  documents: TopicAnalysisDocument[]
}

const completeTopic = async ({
  client,
  workDir,
  prompt,
  label,
  utterances,
  documents
}: CompleteTopicParams) => {
  let raw: string
  try {
    raw = await client.complete({
      system: TOPIC_ANALYSIS_SYSTEM_PROMPT,
      prompt,
      maxTokens: SUMMARY_MAX_PREDICT_TOKENS,
      label,
      workDir,
      temperature: 0
    })
  } catch (caught) {
    const diagnostics =
      caught instanceof BinaryExecutionError
        ? {
            code: caught.code,
            stdoutPath: caught.stdoutPath,
            stderrPath: caught.stderrPath
          }
        : undefined
    await writeJson({
      file: path.join(workDir, `${label}.failure.json`),
      value: {
        label,
        provider: client.provider,
        model: client.model,
        promptVersion: TOPIC_ANALYSIS_PROMPT_VERSION,
        error: messageOf(caught),
        diagnostics
      }
    })
    throw caught
  }
  await writeFile(path.join(workDir, `${label}.raw.txt`), raw, { encoding: 'utf8', flag: 'wx' })

  return parseTopicAnalysis({
    raw,
    utterances,
    documents,
    createDocumentId: randomUUID
  })
}

interface TopicMapReduceParams {
  client: LlmClient
  chunks: TopicAnalysisUtterance[][]
  documents: TopicAnalysisDocument[]
  workDir: string
  onProgress: (progress: ProgressParams) => void
}

const topicMapReduce = async ({
  client,
  chunks,
  documents,
  workDir,
  onProgress
}: TopicMapReduceParams) => {
  const partials: TopicAnalysisResult[] = []
  const allUtterances = chunks.flat()

  for (const [index, utterances] of chunks.entries()) {
    onProgress({ stage: 'summarize', percent: (index / chunks.length) * MAP_PERCENT })
    const partial = await completeTopic({
      client,
      workDir,
      prompt: buildTopicChunkPrompt({ utterances, documents, index, total: chunks.length }),
      label: `topic-chunk-${index}`,
      utterances,
      documents
    })
    await writeJson({
      file: path.join(workDir, `topic-chunk-${index}.partial.json`),
      value: partial
    })
    partials.push(partial)
  }

  onProgress({ stage: 'reduce', percent: MAP_PERCENT })
  const reduced = await completeTopic({
    client,
    workDir,
    prompt: buildTopicReducePrompt({ partials, documents, utterances: allUtterances }),
    label: 'topic-reduce',
    utterances: allUtterances,
    documents
  })
  await writeJson({ file: path.join(workDir, 'topic-reduce.result.json'), value: reduced })

  return { partials, result: reduced }
}

export const runTopicAnalysis = async ({
  meetingId,
  utterances,
  documents,
  onProgress
}: RunTopicAnalysisParams): Promise<TopicAnalysisAttempt> => {
  const attemptId = randomUUID()
  const workDir = await createAttemptDir({ meetingId, attemptId })
  const emptyResult: TopicAnalysisResult = { schemaVersion: 1, topics: [] }
  if (!utterances.length) {
    const attempt: TopicAnalysisAttempt = {
      id: attemptId,
      provider: 'local',
      model: null,
      promptVersion: TOPIC_ANALYSIS_PROMPT_VERSION,
      rawResponses: [],
      partialResults: [],
      result: emptyResult
    }
    await writeJson({ file: path.join(workDir, 'attempt.json'), value: attempt })

    return attempt
  }

  const client = await createLlmClient()
  assertTopicCatalogFits({ documents, budgetChars: client.chunkBudgetChars })
  const chunks = splitTopicAnalysisUtterances({
    utterances,
    budgetChars: client.chunkBudgetChars
  })

  info(
    `회의 ${meetingId} 주제 분석 시작 (${client.provider}, 발화 ${utterances.length}개, 구간 ${chunks.length}개)`
  )

  if (!chunks.length) {
    const attempt: TopicAnalysisAttempt = {
      id: attemptId,
      provider: client.provider,
      model: client.model,
      promptVersion: TOPIC_ANALYSIS_PROMPT_VERSION,
      rawResponses: [],
      partialResults: [],
      result: emptyResult
    }
    await writeJson({ file: path.join(workDir, 'attempt.json'), value: attempt })

    return attempt
  }

  const { partials, result } =
    chunks.length === 1
      ? await (async () => {
          onProgress({ stage: 'summarize', percent: 0 })

          return {
            partials: [],
            result: await completeTopic({
              client,
              workDir,
              prompt: buildTopicWholePrompt({ utterances: chunks[0], documents }),
              label: 'topic-whole',
              utterances: chunks[0],
              documents
            })
          }
        })()
      : await topicMapReduce({ client, chunks, documents, workDir, onProgress })

  const rawResponses = await Promise.all(
    (chunks.length === 1
      ? ['topic-whole']
      : [...chunks.map((_, index) => `topic-chunk-${index}`), 'topic-reduce']
    ).map(async (label) => ({
      label,
      text: await readFile(path.join(workDir, `${label}.raw.txt`), 'utf8')
    }))
  )
  const attempt: TopicAnalysisAttempt = {
    id: attemptId,
    provider: client.provider,
    model: client.model,
    promptVersion: TOPIC_ANALYSIS_PROMPT_VERSION,
    rawResponses,
    partialResults: partials,
    result
  }
  await writeJson({ file: path.join(workDir, 'attempt.json'), value: attempt })

  return attempt
}
