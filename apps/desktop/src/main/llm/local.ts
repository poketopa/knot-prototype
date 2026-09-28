import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CHUNK_BUDGET_CHARS, SUMMARY_CTX_TOKENS } from '@shared/summary'
import { llamaBinPath } from '../bin/paths'
import { runBinary } from '../bin/spawn'
import { threadPlan } from '../bin/threads'
import { isSummaryModelReady, modelPath, summaryModelLabel } from '../models/paths'
import { buildLlamaArgs, extractAnswer, SUMMARY_TEMPERATURE } from '../summary/llama'

import type { LlmClient, LlmCompleteParams } from './types'

const LOCAL_LLM_TIMEOUT_MS = 10 * 60 * 1000

/** 실행 파일·모델이 없으면 spawn 전에 한국어로 안내하고 멈춘다 */
export const isLocalLlmReady = () => existsSync(llamaBinPath()) && isSummaryModelReady()

const ensureReady = () => {
  if (!existsSync(llamaBinPath())) {
    throw new Error('요약 실행 파일(llama-cli)이 준비되지 않았습니다')
  }
  if (!isSummaryModelReady()) throw new Error(`${summaryModelLabel()}이 준비되지 않았습니다`)
}

/**
 * llama-cli를 한 번 돌려 답변만 돌려준다. 프롬프트·시스템 프롬프트·(있으면) 문법·출력을 전부
 * `workDir`의 파일로 주고받는다 (references/architecture.md "로컬 LLM 요약").
 */
const complete = async ({
  system,
  prompt,
  maxTokens,
  grammar,
  label,
  workDir,
  contextTokens = SUMMARY_CTX_TOKENS,
  temperature = SUMMARY_TEMPERATURE
}: LlmCompleteParams) => {
  ensureReady()

  const systemPromptPath = path.join(workDir, `${label}.system.txt`)
  const promptPath = path.join(workDir, `${label}.prompt.txt`)
  const outputPath = path.join(workDir, `${label}.out.txt`)
  const grammarPath = grammar ? path.join(workDir, `${label}.gbnf`) : undefined
  await writeFile(systemPromptPath, system, 'utf8')
  await writeFile(promptPath, prompt, 'utf8')
  if (grammarPath && grammar) await writeFile(grammarPath, grammar, 'utf8')
  const { summary: threads } = await threadPlan()

  await runBinary({
    command: llamaBinPath(),
    args: buildLlamaArgs({
      modelPath: modelPath('summary'),
      systemPromptPath,
      promptPath,
      outputPath,
      grammarPath,
      threads,
      ctxTokens: contextTokens,
      maxPredictTokens: maxTokens,
      temperature
    }),
    timeoutMs: LOCAL_LLM_TIMEOUT_MS,
    stdoutPath: path.join(workDir, `${label}.llama.stdout.txt`),
    stderrPath: path.join(workDir, `${label}.llama.stderr.txt`)
  })

  return extractAnswer({ raw: await readFile(outputPath, 'utf8'), prompt })
}

export const createLocalClient = (): LlmClient => ({
  provider: 'local',
  model: summaryModelLabel(),
  chunkBudgetChars: CHUNK_BUDGET_CHARS,
  complete
})
