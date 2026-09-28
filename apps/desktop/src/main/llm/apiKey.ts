import { safeStorage } from 'electron'
import type { LlmApiKeyStatus, LlmApiVendor } from '@shared/types'
import { apiKeyTailOf, LLM_API_KEY_LABELS } from '@shared/llm'
import { getEncryptedApiKey, setEncryptedApiKey } from '../db/settings'
import { messageOf, warn } from '../log'

/**
 * API 키는 회사별로 `safeStorage`로 암호화해 settings 테이블에 base64로 둔다 (references/data-model.md).
 * 평문은 요청 직전 이 모듈 안에서만 잠깐 존재하고, renderer로는 유무와 꼬리만 나간다.
 */
const ensureEncryptionAvailable = () => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('이 환경에서는 키를 안전하게 저장할 수 없습니다 (키체인 접근 불가)')
  }
}

interface SaveApiKeyParams {
  vendor: LlmApiVendor
  apiKey: string
}

export const saveApiKey = ({ vendor, apiKey }: SaveApiKeyParams) => {
  ensureEncryptionAvailable()
  setEncryptedApiKey({
    vendor,
    encrypted: safeStorage.encryptString(apiKey).toString('base64')
  })
}

export const clearApiKey = ({ vendor }: { vendor: LlmApiVendor }) =>
  setEncryptedApiKey({ vendor, encrypted: null })

/** 복호화에 실패하면(다른 사용자 계정·키체인 초기화) 없는 것으로 본다. 앱이 멈추면 안 된다 */
export const readApiKey = ({ vendor }: { vendor: LlmApiVendor }) => {
  const encrypted = getEncryptedApiKey({ vendor })
  if (!encrypted) return null

  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  } catch (caught) {
    warn(`${LLM_API_KEY_LABELS[vendor]} 복호화 실패: ${messageOf(caught)}`)
    return null
  }
}

export const apiKeyStatusOf = ({ vendor }: { vendor: LlmApiVendor }): LlmApiKeyStatus => {
  const apiKey = readApiKey({ vendor })

  return { isSaved: apiKey !== null, tail: apiKey ? apiKeyTailOf(apiKey) : null }
}
