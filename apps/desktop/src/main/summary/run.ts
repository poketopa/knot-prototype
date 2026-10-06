import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
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
  topicAnalysisPromptVersionForVariant,
  topicAnalysisSystemPromptForVariant,
  TOPIC_ANALYSIS_MAX_PREDICT_TOKENS,
  TOPIC_ANALYSIS_LOCAL_INPUT_CHARS,
  TOPIC_ANALYSIS_JSON_GRAMMAR
} from '@shared/summary'
import type { TopicAnalysisPromptVariant } from '@shared/summary'
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
import { mergeTopicPartials } from './mergeTopicPartials'

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
  variant?: TopicAnalysisPromptVariant
  client?: LlmClient
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
  rawLabels: string[]
  variant: TopicAnalysisPromptVariant
}

const topicInputBudget = (client: LlmClient) =>
  client.provider === 'local'
    ? Math.min(client.chunkBudgetChars, TOPIC_ANALYSIS_LOCAL_INPUT_CHARS)
    : client.chunkBudgetChars

const topicPromptFits = ({
  client,
  prompt,
  variant
}: {
  client: LlmClient
  prompt: string
  variant: TopicAnalysisPromptVariant
}) =>
  prompt.length + topicAnalysisSystemPromptForVariant(variant).length <= topicInputBudget(client)

const completeTopic = async ({
  client,
  workDir,
  prompt,
  label,
  utterances,
  documents,
  rawLabels,
  variant
}: CompleteTopicParams) => {
  const system = topicAnalysisSystemPromptForVariant(variant)
  const promptVersion = topicAnalysisPromptVersionForVariant(variant)
  try {
    if (!topicPromptFits({ client, prompt, variant })) {
      throw new Error('AI 분석 입력이 모델의 처리 범위를 넘었습니다. 원본 전사는 보관되어 있습니다')
    }
    const cacheKey = JSON.stringify({
      provider: client.provider,
      model: client.model,
      promptVersion,
      system,
      prompt
    })
    await writeFile(path.join(workDir, `${label}.input.json`), cacheKey, { flag: 'wx' })
    // 같은 사용자·전사·분류 목록·모델·프롬프트로 실패한 시도에서 검증 가능한
    // 구간 응답만 재사용한다. 전체 결과와 실패 응답은 캐시하지 않는다.
    if (label.startsWith('topic-chunk-')) {
      const parent = path.dirname(workDir)
      const previousAttempts = await readdir(parent, { withFileTypes: true })
      for (const entry of previousAttempts.filter((entry) => entry.isDirectory()).slice(-64)) {
        const previousDir = path.join(parent, entry.name)
        if (previousDir === workDir) continue
        let raw: string
        let result: TopicAnalysisResult
        try {
          if ((await readFile(path.join(previousDir, `${label}.input.json`), 'utf8')) !== cacheKey)
            continue
          raw = await readFile(path.join(previousDir, `${label}.raw.txt`), 'utf8')
          result = parseTopicAnalysis({ raw, utterances, documents, createDocumentId: randomUUID })
        } catch {
          continue
        }
        await writeFile(path.join(workDir, `${label}.raw.txt`), raw, { flag: 'wx' })
        await writeJson({
          file: path.join(workDir, `${label}.reused.json`),
          value: { previousAttempt: entry.name }
        })
        rawLabels.push(label)
        return result
      }
    }
    const raw = await client.complete({
      system,
      prompt,
      maxTokens: TOPIC_ANALYSIS_MAX_PREDICT_TOKENS,
      label,
      workDir,
      temperature: 0,
      grammar: client.provider === 'local' ? TOPIC_ANALYSIS_JSON_GRAMMAR : undefined
    })
    await writeFile(path.join(workDir, `${label}.raw.txt`), raw, { encoding: 'utf8', flag: 'wx' })
    rawLabels.push(label)

    return parseTopicAnalysis({ raw, utterances, documents, createDocumentId: randomUUID })
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
        promptVersion,
        error: messageOf(caught),
        diagnostics
      }
    })
    throw caught
  }
}

interface TopicMapReduceParams {
  client: LlmClient
  chunks: TopicAnalysisUtterance[][]
  documents: TopicAnalysisDocument[]
  workDir: string
  onProgress: (progress: ProgressParams) => void
  rawLabels: string[]
  variant: TopicAnalysisPromptVariant
}

const sourceIdsOf = (results: TopicAnalysisResult[]) =>
  new Set(
    results.flatMap((result) =>
      result.topics.flatMap((topic) => {
        if ('summarySections' in topic) {
          return [
            ...topic.summarySections.flatMap((section) => section.sourceUtteranceIds),
            ...topic.outline.flatMap((section) =>
              section.items.flatMap((item) => item.sourceUtteranceIds)
            )
          ]
        }

        return [...topic.decisions, ...topic.unresolved].flatMap(
          (point) => point.sourceUtteranceIds
        )
      })
    )
  )

const leafFingerprint = ({ text, sourceIds }: { text: string; sourceIds: string[] }) =>
  `${[...new Set(sourceIds)].sort().join(',')}::${text.replace(/\s+/g, ' ').trim()}`

const sourcedLeafFingerprintsOf = (results: TopicAnalysisResult[]) =>
  new Set(
    results.flatMap((result) =>
      result.topics.flatMap((topic) => {
        if ('summarySections' in topic) {
          return [
            ...topic.summarySections.map((section) =>
              leafFingerprint({ text: section.text, sourceIds: section.sourceUtteranceIds })
            ),
            ...topic.outline.flatMap((section) =>
              section.items.map((item) =>
                leafFingerprint({ text: item.text, sourceIds: item.sourceUtteranceIds })
              )
            )
          ]
        }

        return [...topic.decisions, ...topic.unresolved].map((point) =>
          leafFingerprint({ text: point.text, sourceIds: point.sourceUtteranceIds })
        )
      })
    )
  )

const topicReconciliationError = (reason: string) =>
  new Error(
    `구간별 AI 정리는 보관했지만 전체 주제 문서를 합치지 못했습니다 (${reason}). 다른 AI 모델로 다시 시도해 주세요`
  )

/** 각 단계의 입력까지 제한한다. 조정하지 못한 구간 결과를 최종 결정으로 공개하지 않는다. */
const reduceTopics = async ({
  client,
  partials,
  documents,
  utterances,
  workDir,
  rawLabels,
  variant
}: Omit<TopicMapReduceParams, 'chunks' | 'onProgress'> & {
  partials: TopicAnalysisResult[]
  utterances: TopicAnalysisUtterance[]
}) => {
  let level = partials
  let round = 0
  while (level.length > 1) {
    const batches: TopicAnalysisResult[][] = []
    let batch: TopicAnalysisResult[] = []
    for (const partial of level) {
      const candidate = [...batch, partial]
      if (
        batch.length &&
        !topicPromptFits({
          client,
          prompt: buildTopicReducePrompt({ partials: candidate, documents, utterances, variant }),
          variant
        })
      ) {
        batches.push(batch)
        batch = []
      }
      batch.push(partial)
    }
    if (batch.length) batches.push(batch)
    if (batches.every((items) => items.length === 1)) {
      // 긴 구간 결과를 다시 AI에 넣으려고 잘라내지 않는다. 명칭이 같은 주제만
      // 연결하고 나머지는 별도 문서로 보존한다. 의미가 다른 제목을 임의로 합치지 않는다.
      const result = mergeTopicPartials(level)
      await writeJson({
        file: path.join(workDir, 'topic-reduce-preserved.json'),
        value: { strategy: 'exact-domain-title', round, result }
      })
      return result
    }

    const next: TopicAnalysisResult[] = []
    for (const [index, items] of batches.entries()) {
      if (items.length === 1) {
        next.push(items[0])
        continue
      }
      let result: TopicAnalysisResult
      try {
        result = await completeTopic({
          client,
          workDir,
          documents,
          utterances,
          rawLabels,
          variant,
          prompt: buildTopicReducePrompt({ partials: items, documents, utterances, variant }),
          label: `topic-reduce-${round}-${index}`
        })
        const preserved = sourceIdsOf([result])
        if ([...sourceIdsOf(items)].some((sourceId) => !preserved.has(sourceId))) {
          throw new Error('합치기 결과에서 기존 주제 내용의 근거가 누락되었습니다')
        }
        const preservedLeaves = sourcedLeafFingerprintsOf([result])
        if ([...sourcedLeafFingerprintsOf(items)].some((leaf) => !preservedLeaves.has(leaf))) {
          // 개수만 같다고 세부 내용이 보존된 것은 아니다. 재작성의 정확성을
          // 확인할 수 없으면 원래 검증한 문구와 근거를 그대로 연결한다.
          result = mergeTopicPartials(items)
          await writeJson({
            file: path.join(workDir, `topic-reduce-${round}-${index}.preserved.json`),
            value: { strategy: 'preserve-original-leaves', result }
          })
        }
      } catch (caught) {
        // 구간별 JSON과 실패 응답은 남기고, 세부사항을 확인하지 못한 결과는 확정하지 않는다.
        throw topicReconciliationError(messageOf(caught))
      }
      next.push(result)
    }
    level = next
    round += 1
  }
  return level[0] ?? { schemaVersion: 2 as const, topics: [] }
}

const topicMapReduce = async ({
  client,
  chunks,
  documents,
  workDir,
  onProgress,
  rawLabels,
  variant
}: TopicMapReduceParams) => {
  const partials: TopicAnalysisResult[] = []
  const allUtterances = chunks.flat()

  for (const [index, utterances] of chunks.entries()) {
    onProgress({ stage: 'summarize', percent: (index / chunks.length) * MAP_PERCENT })
    const partial = await completeTopic({
      client,
      workDir,
      prompt: buildTopicChunkPrompt({
        utterances,
        documents,
        index,
        total: chunks.length,
        variant
      }),
      label: `topic-chunk-${index}`,
      utterances,
      documents,
      rawLabels,
      variant
    })
    await writeJson({
      file: path.join(workDir, `topic-chunk-${index}.partial.json`),
      value: partial
    })
    partials.push(partial)
  }

  onProgress({ stage: 'reduce', percent: MAP_PERCENT })
  const reduced = await reduceTopics({
    client,
    partials,
    documents,
    utterances: allUtterances,
    workDir,
    rawLabels,
    variant
  })
  await writeJson({ file: path.join(workDir, 'topic-reduce.result.json'), value: reduced })

  return { partials, result: reduced }
}

export const runTopicAnalysis = async ({
  meetingId,
  utterances,
  documents,
  onProgress,
  variant = 'A',
  client: providedClient
}: RunTopicAnalysisParams): Promise<TopicAnalysisAttempt> => {
  const attemptId = randomUUID()
  const workDir = await createAttemptDir({ meetingId, attemptId })
  const emptyResult: TopicAnalysisResult = { schemaVersion: 2, topics: [] }
  const promptVersion = topicAnalysisPromptVersionForVariant(variant)
  if (!utterances.length) {
    const attempt: TopicAnalysisAttempt = {
      id: attemptId,
      provider: 'local',
      model: null,
      promptVersion,
      rawResponses: [],
      partialResults: [],
      result: emptyResult
    }
    await writeJson({ file: path.join(workDir, 'attempt.json'), value: attempt })

    return attempt
  }

  const client = providedClient ?? (await createLlmClient())
  const inputBudget = topicInputBudget(client)
  const overhead =
    topicAnalysisSystemPromptForVariant(variant).length +
    Math.max(
      buildTopicWholePrompt({ documents, utterances: [], variant }).length,
      buildTopicChunkPrompt({
        documents,
        utterances: [],
        index: utterances.length,
        total: utterances.length,
        variant
      }).length
    )
  assertTopicCatalogFits({ documents, budgetChars: inputBudget })
  const transcriptBudget = inputBudget - overhead - 16
  if (transcriptBudget < 128) {
    throw new Error('기존 문서 목록과 AI 지시문이 너무 커서 회의록을 분석할 공간이 없습니다')
  }
  const chunks = splitTopicAnalysisUtterances({
    utterances,
    budgetChars: transcriptBudget
  })
  const rawLabels: string[] = []

  info(
    `회의 ${meetingId} 주제 분석 시작 (${client.provider}, 발화 ${utterances.length}개, 구간 ${chunks.length}개)`
  )

  if (!chunks.length) {
    const attempt: TopicAnalysisAttempt = {
      id: attemptId,
      provider: client.provider,
      model: client.model,
      promptVersion,
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
              prompt: buildTopicWholePrompt({ utterances: chunks[0], documents, variant }),
              label: 'topic-whole',
              utterances: chunks[0],
              documents,
              rawLabels,
              variant
            })
          }
        })()
      : await topicMapReduce({ client, chunks, documents, workDir, onProgress, rawLabels, variant })

  const rawResponses = await Promise.all(
    rawLabels.map(async (label) => ({
      label,
      text: await readFile(path.join(workDir, `${label}.raw.txt`), 'utf8')
    }))
  )
  const attempt: TopicAnalysisAttempt = {
    id: attemptId,
    provider: client.provider,
    model: client.model,
    promptVersion,
    rawResponses,
    partialResults: partials,
    result
  }
  await writeJson({ file: path.join(workDir, 'attempt.json'), value: attempt })

  return attempt
}
