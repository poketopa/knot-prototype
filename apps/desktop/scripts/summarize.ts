import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  buildChunkPrompt,
  buildReducePrompt,
  buildWholePrompt,
  splitTranscript,
  SUMMARY_SYSTEM_PROMPT
} from '@shared/summary'

import { threadPlan } from '../src/main/bin/threads'
import { buildSummaryArgs, parseSummaryOutput } from '../src/main/summary/llama'
import { SUMMARY_MODEL_ASSET } from '@meeting-stt/models/desktop'
import { fail, info } from './log'
import { BIN_DIR, MODELS_DIR, OUTPUT_DIR } from './paths'
import { run } from './shell'

/**
 * Phase 5 요약 검증 스크립트. 앱 UI 없이 회의록 텍스트 하나를 요약해 시간·결과를 확인한다.
 * 앱 런타임(`src/main/summary/run.ts`)과 같은 프롬프트·인자를 쓰되, electron 의존을 피하려고
 * 오케스트레이션만 여기서 다시 쓴다 (`scripts/pipeline.ts`와 같은 구조).
 *
 * 사용법: pnpm tsx scripts/summarize.ts <회의록.txt>
 */
const LLAMA_BIN = path.join(BIN_DIR, 'llama-cli')
const SUMMARY_MODEL = path.join(MODELS_DIR, SUMMARY_MODEL_ASSET.fileName)

const seconds = (startedAt: number) => ((performance.now() - startedAt) / 1000).toFixed(1)

interface CompleteParams {
  workDir: string
  systemPromptPath: string
  prompt: string
  label: string
}

const complete = async ({ workDir, systemPromptPath, prompt, label }: CompleteParams) => {
  const promptPath = path.join(workDir, `${label}.prompt.txt`)
  const outputPath = path.join(workDir, `${label}.out.txt`)
  await writeFile(promptPath, prompt, 'utf8')

  const startedAt = performance.now()
  const { summary: threads } = await threadPlan()
  const { code, stderr } = await run({
    command: LLAMA_BIN,
    args: buildSummaryArgs({
      modelPath: SUMMARY_MODEL,
      systemPromptPath,
      promptPath,
      outputPath,
      threads
    })
  })
  if (code !== 0) fail(`llama-cli 비정상 종료 (코드 ${code})\n${stderr.slice(-800)}`)

  const summary = parseSummaryOutput({ raw: await readFile(outputPath, 'utf8'), prompt })
  info(
    `· ${label} 완료 ${seconds(startedAt)}초 (프롬프트 ${prompt.length}자 → ${summary.length}자)`
  )

  return summary
}

const summarize = async ({ transcript, workDir }: { transcript: string; workDir: string }) => {
  const chunks = splitTranscript({ text: transcript })
  if (!chunks.length) fail('요약할 회의록이 비어 있습니다')

  const systemPromptPath = path.join(workDir, 'system.txt')
  await writeFile(systemPromptPath, SUMMARY_SYSTEM_PROMPT, 'utf8')
  info(`회의록 ${transcript.length}자를 구간 ${chunks.length}개로 나눴습니다`)

  if (chunks.length === 1) {
    return complete({
      workDir,
      systemPromptPath,
      prompt: buildWholePrompt({ transcript: chunks[0] }),
      label: 'whole'
    })
  }

  const partials: string[] = []
  for (const [index, chunk] of chunks.entries()) {
    partials.push(
      await complete({
        workDir,
        systemPromptPath,
        prompt: buildChunkPrompt({ chunk, index, total: chunks.length }),
        label: `chunk-${index}`
      })
    )
  }

  return complete({
    workDir,
    systemPromptPath,
    prompt: buildReducePrompt({ partials }),
    label: 'reduce'
  })
}

const main = async () => {
  const [transcriptPath] = process.argv.slice(2)
  if (!transcriptPath) fail('사용법: pnpm tsx scripts/summarize.ts <회의록.txt>')
  if (!existsSync(transcriptPath)) fail(`회의록을 찾을 수 없습니다: ${transcriptPath}`)
  if (!existsSync(LLAMA_BIN))
    fail(`llama-cli가 없습니다. pnpm tsx scripts/setupBin.ts 를 먼저 실행해 주세요`)
  if (!existsSync(SUMMARY_MODEL)) {
    fail(`요약 모델이 없습니다. pnpm tsx scripts/setupModels.ts --summary 를 먼저 실행해 주세요`)
  }

  const name = path.basename(transcriptPath).replace(/\.[^.]+$/, '')
  const workDir = path.join(OUTPUT_DIR, `${name}.summary.work`)
  await mkdir(workDir, { recursive: true })

  const startedAt = performance.now()
  try {
    const summary = await summarize({
      transcript: await readFile(transcriptPath, 'utf8'),
      workDir
    })
    const destPath = path.join(OUTPUT_DIR, `${name}.summary.md`)
    await writeFile(destPath, `${summary}\n`, 'utf8')

    info(`요약 완료 ${seconds(startedAt)}초 → ${destPath}`)
    info(`\n${summary}`)
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error))
})
