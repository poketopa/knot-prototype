import type { SetLlmApiKeyRequest, SetLlmProviderRequest, SetOpenaiModelRequest } from '@shared/ipc'

// Electron은 main에서 던진 에러를 "Error invoking remote method '<채널>': Error: <원문>"으로 감싼다
const REMOTE_ERROR_PREFIX = /^Error invoking remote method '[^']+': (?:Error: )?/

const STATUS_ERROR_MESSAGE = 'LLM 설정을 불러오지 못했습니다'
const PROVIDER_ERROR_MESSAGE = 'LLM 공급자를 저장하지 못했습니다'
const API_KEY_ERROR_MESSAGE = 'API 키를 저장하지 못했습니다'
const OPENAI_MODEL_ERROR_MESSAGE = 'GPT 모델을 저장하지 못했습니다'
const CHECK_ERROR_MESSAGE = '연결을 확인하지 못했습니다'

interface ToUserErrorParams {
  caught: unknown
  fallback: string
}

// main이 던진 에러만 원문(한국어 안내)을 그대로 쓴다. 브리지가 없어서 나는 TypeError 같은
// renderer 쪽 예외는 사용자에게 의미가 없으므로 안내 문구로 바꾼다
const toUserError = ({ caught, fallback }: ToUserErrorParams) => {
  if (!(caught instanceof Error) || !REMOTE_ERROR_PREFIX.test(caught.message)) {
    return new Error(fallback)
  }

  return new Error(caught.message.replace(REMOTE_ERROR_PREFIX, ''))
}

interface InvokeLlmParams<T> {
  call: () => Promise<T>
  fallback: string
}

const invokeLlm = async <T>({ call, fallback }: InvokeLlmParams<T>) => {
  try {
    return await call()
  } catch (caught) {
    throw toUserError({ caught, fallback })
  }
}

/**
 * @description 요약·용어 초안이 쓰는 LLM 공급자의 현재 상태를 불러옵니다. API 키 자체는 오지 않고 유무와 마지막 4자만 옵니다.
 * @returns 공급자, 로컬 모델 준비 여부, 회사별 키 유무, GPT 모델, `claude` 실행 파일 경로·버전
 * @example
 * const status = await getLlmStatusApi()
 */
export const getLlmStatusApi = async () =>
  invokeLlm({ call: () => window.api.llm.status(), fallback: STATUS_ERROR_MESSAGE })

/**
 * @description LLM 공급자를 저장합니다. 진행 중인 요약에는 적용되지 않고 다음 잡부터 바뀝니다.
 * @param provider - 'local' | 'claude-api' | 'claude-cli' | 'openai-api'
 * @returns 갱신된 상태
 * @example
 * const status = await setLlmProviderApi({ provider: 'claude-api' })
 */
export const setLlmProviderApi = async ({ provider }: SetLlmProviderRequest) =>
  invokeLlm({
    call: () => window.api.llm.setProvider({ provider }),
    fallback: PROVIDER_ERROR_MESSAGE
  })

/**
 * @description 회사별 API 키를 저장하거나 지웁니다. main이 암호화해 저장하며 키를 되돌려주지 않습니다.
 * @param vendor - 'anthropic' | 'openai'
 * @param apiKey - 저장할 키. `null`이면 저장된 키를 지웁니다
 * @returns 갱신된 상태
 * @example
 * const status = await setLlmApiKeyApi({ vendor: 'openai', apiKey: 'sk-proj-…' })
 */
export const setLlmApiKeyApi = async ({ vendor, apiKey }: SetLlmApiKeyRequest) =>
  invokeLlm({
    call: () => window.api.llm.setApiKey({ vendor, apiKey }),
    fallback: API_KEY_ERROR_MESSAGE
  })

/**
 * @description OpenAI API가 부를 GPT 모델을 저장합니다. 다음 요약부터 적용됩니다.
 * @param model - 'gpt-6-astra' | 'gpt-6-sol' | 'gpt-6-luna'
 * @returns 갱신된 상태
 * @example
 * const status = await setOpenaiModelApi({ model: 'gpt-6-luna' })
 */
export const setOpenaiModelApi = async ({ model }: SetOpenaiModelRequest) =>
  invokeLlm({
    call: () => window.api.llm.setOpenaiModel({ model }),
    fallback: OPENAI_MODEL_ERROR_MESSAGE
  })

/**
 * @description 현재 공급자로 짧은 프롬프트 한 번을 보내 연결을 확인합니다. 실패하면 한국어 메시지로 reject됩니다.
 * @returns 성공 안내 문구
 * @example
 * const { message } = await checkLlmApi()
 */
export const checkLlmApi = async () =>
  invokeLlm({ call: () => window.api.llm.check(), fallback: CHECK_ERROR_MESSAGE })
