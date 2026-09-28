import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  applyRefinePairs,
  buildReadingGrammar,
  buildReadingPrompt,
  buildVerifyGrammar,
  buildVerifyPrompt,
  findRefineCandidates,
  parseReadings,
  parseVerifyOutput,
  READING_MAX_PREDICT_TOKENS,
  READING_SYSTEM_PROMPT,
  REFINE_CTX_TOKENS,
  splitVerifyBatches,
  VERIFY_MAX_PREDICT_TOKENS,
  VERIFY_SYSTEM_PROMPT
} from '@shared/refine'
import type { RefinePair, RefineSource, RefineSuggestion } from '@shared/types'

import { threadPlan } from '../src/main/bin/threads'
import { parseSummaryOutput } from '../src/main/summary/llama'
import { SUMMARY_MODEL_ASSET } from '@meeting-stt/models/desktop'
import { fail, info } from './log'
import { BIN_DIR, MODELS_DIR, OUTPUT_DIR } from './paths'
import { run } from './shell'

/**
 * Phase 5-4 교정 검증 스크립트. 용어 사전을 받아 발음 유사도로 치환 후보를 만들고 LLM이 판정한다.
 * 통과한 제안과 떨어진 후보를 모두 리포트로 남긴다 (references/roadmap.md 5-4).
 *
 * 사용법: pnpm --filter meeting-stt exec tsx scripts/refine.ts <회의록.txt> --glossary <용어 파일>
 *         [--mode llm|code]
 * 용어 파일은 한 줄에 용어 하나. `code`는 LLM 판정 없이 후보를 전부 받아들이는 비교 기준선이다.
 * 결과는 `fixtures/output/<이름>.refine.<mode>.md`
 */
const LLAMA_BIN = path.join(BIN_DIR, 'llama-cli')
const SUMMARY_MODEL = path.join(MODELS_DIR, SUMMARY_MODEL_ASSET.fileName)

/** 판정은 창작이 아니다. 요약(0.3)보다 낮추되 0은 반복을 부르므로 피한다 */
const REFINE_TEMPERATURE = 0.1

const TRANSCRIPT_LINE = /^\[(\d{2}:\d{2}:\d{2})\] ([^:]+): (.*)$/

type RefineMode = 'llm' | 'code'

const seconds = (startedAt: number) => ((performance.now() - startedAt) / 1000).toFixed(1)

const optionOf = (name: string) => {
  const args = process.argv.slice(2)
  const at = args.indexOf(name)
  return at < 0 ? undefined : args[at + 1]
}

/** 회의록 줄 번호를 발화 id로 쓴다. 리포트에서 원문 줄을 바로 찾을 수 있다 */
const parseTranscript = (text: string) =>
  text
    .split('\n')
    .map((line, index) => ({ match: TRANSCRIPT_LINE.exec(line), index }))
    .filter(({ match }) => match !== null)
    .map(({ match, index }) => ({
      id: String(index + 1),
      time: match?.[1] ?? '',
      text: match?.[3] ?? ''
    }))

interface CompleteParams {
  workDir: string
  systemPrompt: string
  prompt: string
  grammar: string
  maxPredictTokens: number
  label: string
}

const complete = async ({
  workDir,
  systemPrompt,
  prompt,
  grammar,
  maxPredictTokens,
  label
}: CompleteParams) => {
  const systemPromptPath = path.join(workDir, `${label}.system.txt`)
  const promptPath = path.join(workDir, `${label}.prompt.txt`)
  const grammarPath = path.join(workDir, `${label}.gbnf`)
  const outputPath = path.join(workDir, `${label}.out.txt`)
  await writeFile(systemPromptPath, systemPrompt, 'utf8')
  await writeFile(promptPath, prompt, 'utf8')
  await writeFile(grammarPath, grammar, 'utf8')

  const { summary: threads } = await threadPlan()
  const { code, stderr } = await run({
    command: LLAMA_BIN,
    args: [
      ...['-m', SUMMARY_MODEL, '-sysf', systemPromptPath, '-f', promptPath, '-o', outputPath],
      ...['--grammar-file', grammarPath],
      ...['-st', '--no-escape', '--no-display-prompt', '--no-warmup', '--no-show-timings'],
      ...['-c', String(REFINE_CTX_TOKENS), '-n', String(maxPredictTokens)],
      ...['--temp', String(REFINE_TEMPERATURE), '-t', String(threads)]
    ]
  })
  if (code !== 0) fail(`llama-cli 비정상 종료 (코드 ${code})\n${stderr.slice(-800)}`)

  return parseSummaryOutput({ raw: await readFile(outputPath, 'utf8'), prompt })
}

const readingsOf = async ({ glossary, workDir }: { glossary: string[]; workDir: string }) => {
  const prompt = buildReadingPrompt({ glossary })
  if (!prompt) return parseReadings({ output: '', glossary })

  const startedAt = performance.now()
  const output = await complete({
    workDir,
    systemPrompt: READING_SYSTEM_PROMPT,
    prompt,
    grammar: buildReadingGrammar({ glossary }),
    maxPredictTokens: READING_MAX_PREDICT_TOKENS,
    label: 'reading'
  })
  info(`· 용어 읽기 ${seconds(startedAt)}초`)

  return parseReadings({ output, glossary })
}

interface VerifyParams {
  sources: RefineSource[]
  candidates: RefinePair[]
  workDir: string
}

const verify = async ({ sources, candidates, workDir }: VerifyParams) => {
  const batches = splitVerifyBatches({ candidates })
  const approved: RefinePair[] = []

  for (const [index, batch] of batches.entries()) {
    const startedAt = performance.now()
    const output = await complete({
      workDir,
      systemPrompt: VERIFY_SYSTEM_PROMPT,
      prompt: buildVerifyPrompt({ batch, sources }),
      grammar: buildVerifyGrammar({ count: batch.length }),
      maxPredictTokens: VERIFY_MAX_PREDICT_TOKENS,
      label: `verify-${index}`
    })
    const passed = parseVerifyOutput({ output, batch })
    approved.push(...passed)
    info(
      `· 판정 ${index + 1}/${batches.length} ${seconds(startedAt)}초, ${batch.length}개 중 ${passed.length}개 통과`
    )
  }

  return approved
}

interface BuildReportParams {
  name: string
  mode: RefineMode
  readings: Map<string, string[]>
  elapsedSec: string
  times: Map<string, string>
  suggestions: RefineSuggestion[]
  dropped: RefinePair[]
}

const pairLabel = ({ from, to }: Pick<RefinePair, 'from' | 'to'>) => `${from} → ${to}`

const buildReport = ({
  name,
  mode,
  readings,
  elapsedSec,
  times,
  suggestions,
  dropped
}: BuildReportParams) =>
  [
    `# 교정 결과: ${name} (${mode})`,
    '',
    `- 소요 ${elapsedSec}초, 제안 발화 ${suggestions.length}개(쌍 ${suggestions.flatMap((s) => s.pairs).length}개), 떨어진 후보 ${dropped.length}개`,
    '',
    '## 용어 발음',
    '',
    ...[...readings.entries()].map(
      ([term, termReadings]) => `- ${term}: ${termReadings.join(', ')}`
    ),
    '',
    '## 받아들인 제안',
    '',
    ...suggestions.flatMap(({ id, before, after, pairs }) => [
      `### 줄 ${id} [${times.get(id)}] ${pairs.map(pairLabel).join(', ')}`,
      `- 전: ${before}`,
      `- 후: ${after}`,
      ''
    ]),
    '## 떨어진 후보',
    '',
    ...dropped.map(
      (pair) => `- 줄 ${pair.utteranceId}: ${pairLabel(pair)} (${pair.similarity.toFixed(2)})`
    ),
    ''
  ].join('\n')

const main = async () => {
  const [transcriptPath] = process.argv.slice(2)
  const glossaryPath = optionOf('--glossary')
  if (!transcriptPath || !glossaryPath) {
    fail('사용법: pnpm tsx scripts/refine.ts <회의록.txt> --glossary <용어 파일> [--mode llm|code]')
  }
  if (!existsSync(transcriptPath)) fail(`회의록을 찾을 수 없습니다: ${transcriptPath}`)
  if (!existsSync(LLAMA_BIN))
    fail(`llama-cli가 없습니다. pnpm tsx scripts/setupBin.ts 를 먼저 실행해 주세요`)
  if (!existsSync(SUMMARY_MODEL)) {
    fail(`요약 모델이 없습니다. pnpm tsx scripts/setupModels.ts --summary 를 먼저 실행해 주세요`)
  }

  const glossary = (await readFile(glossaryPath, 'utf8')).split('\n').filter((t) => t.trim())
  const mode: RefineMode = optionOf('--mode') === 'code' ? 'code' : 'llm'

  const lines = parseTranscript(await readFile(transcriptPath, 'utf8'))
  if (!lines.length) fail('회의록에서 발화 줄을 찾지 못했습니다')
  const sources = lines.map(({ id, text }) => ({ id, text }))

  const name = path.basename(transcriptPath).replace(/\.[^.]+$/, '')
  const workDir = path.join(OUTPUT_DIR, `${name}.refine.work`)
  await mkdir(workDir, { recursive: true })

  const startedAt = performance.now()
  try {
    const readings = await readingsOf({ glossary, workDir })
    const candidates = findRefineCandidates({ sources, readings })
    info(`후보 ${candidates.length}개`)
    const approved = mode === 'code' ? candidates : await verify({ sources, candidates, workDir })
    const suggestions = applyRefinePairs({ sources, pairs: approved })
    const dropped = candidates.filter((candidate) => !approved.includes(candidate))

    const report = buildReport({
      name,
      mode,
      readings,
      elapsedSec: seconds(startedAt),
      times: new Map(lines.map(({ id, time }) => [id, time])),
      suggestions,
      dropped
    })
    const destPath = path.join(OUTPUT_DIR, `${name}.refine.${mode}.md`)
    await writeFile(destPath, report, 'utf8')
    info(`교정 완료 ${seconds(startedAt)}초 → ${destPath}`)
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error))
})
