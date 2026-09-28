import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { CheckLlmResponse } from '@shared/ipc'
import { LLM_CHECK_PROMPT, LLM_CHECK_SYSTEM_PROMPT, LLM_PROVIDER_LABELS } from '@shared/llm'
import { summaryModelLabel } from '../models/paths'

import { createLlmClient } from './provider'

/** "확인" 한 마디면 충분하다. Claude는 사고 토큰 때문에 하한(16K)으로 올라간다 */
const CHECK_MAX_TOKENS = 64

/** 답변이 길어도 화면에는 한 줄만 보여준다 */
const ANSWER_PREVIEW_CHARS = 40

/**
 * 설정 화면의 "연결 확인". 큐를 거치지 않는다 — 짧고, 로컬은 spawn 대신 모델 존재만 확인해 돌려준다
 * (references/architecture.md "LLM 공급자" IPC).
 */
export const checkLlm = async (): Promise<CheckLlmResponse> => {
  const client = await createLlmClient()
  if (client.provider === 'local') {
    return { message: `${summaryModelLabel()}이 준비되어 있습니다` }
  }

  const workDir = path.join(app.getPath('userData'), 'llm', 'check')
  await mkdir(workDir, { recursive: true })

  try {
    const answer = await client.complete({
      system: LLM_CHECK_SYSTEM_PROMPT,
      prompt: LLM_CHECK_PROMPT,
      maxTokens: CHECK_MAX_TOKENS,
      label: 'check',
      workDir
    })
    const preview = answer.trim().replace(/\s+/g, ' ').slice(0, ANSWER_PREVIEW_CHARS)

    return { message: `${LLM_PROVIDER_LABELS[client.provider]}에 연결했습니다 (응답: ${preview})` }
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}
