import type { LlmStatus, OpenaiModelId } from '@shared/types'
import { API_CHUNK_BUDGET_CHARS, CLAUDE_API_MODEL_ID, llmMissingMessage } from '@shared/llm'
import { getLlmProvider, getOpenaiModel } from '../db/settings'

import { apiKeyStatusOf, readApiKey } from './apiKey'
import { completeWithClaudeApi } from './claudeApi'
import { completeWithClaudeCli, locateClaudeCli } from './claudeCli'
import { completeWithCodexCli, locateCodexCli } from './codexCli'
import { createLocalClient, isLocalLlmReady } from './local'
import { completeWithOpenaiApi } from './openaiApi'
import type { LlmClient } from './types'

/** 설정 화면과 잡 시작 전 확인이 함께 쓰는 현재 상태 (references/architecture.md "LLM 공급자") */
export const getLlmStatus = async (): Promise<LlmStatus> => {
  const [claudeCli, codexCli] = await Promise.all([locateClaudeCli(), locateCodexCli()])

  return {
    provider: getLlmProvider(),
    isLocalModelReady: isLocalLlmReady(),
    apiKeys: {
      anthropic: apiKeyStatusOf({ vendor: 'anthropic' }),
      openai: apiKeyStatusOf({ vendor: 'openai' })
    },
    openaiModel: getOpenaiModel(),
    claudeCliPath: claudeCli.path,
    claudeCliVersion: claudeCli.version,
    codexCliPath: codexCli.path,
    codexCliVersion: codexCli.version,
    isCodexCliSandboxSupported: codexCli.isSandboxSupported,
    codexCliUnsupportedReason: codexCli.unsupportedReason
  }
}

const createClaudeApiClient = ({ apiKey }: { apiKey: string }): LlmClient => ({
  provider: 'claude-api',
  model: CLAUDE_API_MODEL_ID,
  chunkBudgetChars: API_CHUNK_BUDGET_CHARS,
  complete: ({ system, prompt, maxTokens }) =>
    completeWithClaudeApi({ apiKey, system, prompt, maxTokens })
})

const createClaudeCliClient = ({ cliPath }: { cliPath: string }): LlmClient => ({
  provider: 'claude-cli',
  model: 'claude-cli-default',
  chunkBudgetChars: API_CHUNK_BUDGET_CHARS,
  complete: ({ system, prompt, workDir, label }) =>
    completeWithClaudeCli({ cliPath, system, prompt, workDir, label })
})

interface CreateOpenaiApiClientParams {
  apiKey: string
  model: OpenaiModelId
}

const createOpenaiApiClient = ({ apiKey, model }: CreateOpenaiApiClientParams): LlmClient => ({
  provider: 'openai-api',
  model,
  chunkBudgetChars: API_CHUNK_BUDGET_CHARS,
  complete: ({ system, prompt, maxTokens }) =>
    completeWithOpenaiApi({ apiKey, model, system, prompt, maxTokens })
})

const createCodexCliClient = ({ cliPath }: { cliPath: string }): LlmClient => ({
  provider: 'codex-cli',
  model: 'codex-cli-default',
  chunkBudgetChars: API_CHUNK_BUDGET_CHARS,
  complete: ({ system, prompt, workDir, label }) =>
    completeWithCodexCli({ cliPath, system, prompt, workDir, label })
})

/**
 * 설정을 한 번 읽어 공급자 클라이언트를 만든다. 잡이 시작할 때 부르므로 진행 중인 잡의 공급자는 바뀌지 않는다.
 * 준비되지 않았으면 spawn·요청 전에 한국어 메시지로 멈춘다.
 */
export const createLlmClient = async (): Promise<LlmClient> => {
  const status = await getLlmStatus()
  const missing = llmMissingMessage(status)
  if (missing) throw new Error(missing)

  if (status.provider === 'claude-api') {
    return createClaudeApiClient({ apiKey: readApiKey({ vendor: 'anthropic' }) as string })
  }
  if (status.provider === 'claude-cli') {
    return createClaudeCliClient({ cliPath: status.claudeCliPath as string })
  }
  if (status.provider === 'openai-api') {
    return createOpenaiApiClient({
      apiKey: readApiKey({ vendor: 'openai' }) as string,
      model: status.openaiModel
    })
  }
  if (status.provider === 'codex-cli') {
    return createCodexCliClient({ cliPath: status.codexCliPath as string })
  }

  return createLocalClient()
}
