/**
 * LLM 공급자 선택의 순수 로직 (references/architecture.md "LLM 공급자").
 * 공급자 유니온·라벨·API 키 회사·GPT 모델 목록·준비 여부 판정과 Claude Code CLI 인자·출력 파싱을 둔다.
 * spawn·SDK 호출·키 저장은 `src/main/llm/*`이 담당한다.
 */

import type { LlmApiVendor, LlmProvider, LlmStatus, OpenaiModelId } from './types'

export const LLM_PROVIDERS: LlmProvider[] = [
  'local',
  'claude-api',
  'claude-cli',
  'openai-api',
  'codex-cli'
]

export const DEFAULT_LLM_PROVIDER: LlmProvider = 'local'

/** 최초 설정은 API 키 없이 준비할 수 있는 실행 방식만 제공한다. */
export const INITIAL_SETUP_PROVIDERS: LlmProvider[] = ['local', 'codex-cli', 'claude-cli']

/** 설정·요약 캡션에 쓰는 한국어 라벨 */
export const LLM_PROVIDER_LABELS: Record<LlmProvider, string> = {
  local: '로컬 모델',
  'claude-api': 'Claude API',
  'claude-cli': 'Claude Code',
  'openai-api': 'OpenAI API',
  'codex-cli': 'Codex CLI'
}

export const LLM_API_VENDORS: LlmApiVendor[] = ['anthropic', 'openai']

/** 키 입력란 라벨과 준비 안내에 쓰는 이름. 회사 이름이 아니라 사용자가 아는 제품 이름으로 적는다 */
export const LLM_API_KEY_LABELS: Record<LlmApiVendor, string> = {
  anthropic: 'Claude API 키',
  openai: 'OpenAI API 키'
}

/** API 호출에 쓰는 Claude 모델. CLI는 사용자가 CLI에 설정한 기본 모델을 쓴다 */
export const CLAUDE_API_MODEL_ID = 'claude-opus-5'

interface OpenaiModelOption {
  id: OpenaiModelId
  title: string
  description: string
}

/** GPT-6 계열 셋. 요금 차이가 커서 사용자가 고른다 (references/architecture.md "LLM 공급자") */
export const OPENAI_MODELS: OpenaiModelOption[] = [
  {
    id: 'gpt-6-astra',
    title: 'GPT-6 Astra',
    description: '가장 뛰어난 모델. 요금이 가장 높습니다'
  },
  { id: 'gpt-6-sol', title: 'GPT-6 Sol', description: '성능과 요금의 균형. 요약에 충분합니다' },
  { id: 'gpt-6-luna', title: 'GPT-6 Luna', description: '가장 저렴하고 빠른 모델' }
]

export const DEFAULT_OPENAI_MODEL_ID: OpenaiModelId = 'gpt-6-sol'

/**
 * 외부 API는 컨텍스트가 커서 회의록을 통째로 넣는다. 40만 자는 약 28만 토큰으로
 * 8시간짜리 회의도 한 번에 들어간다 (references/architecture.md).
 */
export const API_CHUNK_BUDGET_CHARS = 400_000

/**
 * Claude의 적응형 사고와 GPT-6의 추론 토큰은 출력 상한에 포함된다. 로컬용 상한(1200)을 그대로 주면
 * 사고만 하다 잘리므로 이 값 아래로는 내리지 않는다.
 */
export const API_MIN_MAX_TOKENS = 16_000

/** Anthropic 키는 `sk-ant-…` 100자 안팎, OpenAI 키는 `sk-proj-…` 200자 안팎이다. 붙여 넣기 실수(회의록 등)를 거른다 */
export const API_KEY_MAX_CHARS = 512
export const API_KEY_TAIL_CHARS = 4

/** 설정 화면 "연결 확인"에 쓰는 한 턴짜리 프롬프트 */
export const LLM_CHECK_SYSTEM_PROMPT =
  '당신은 연결 확인에 응답하는 도우미입니다. 요청받은 말만 출력합니다.'
export const LLM_CHECK_PROMPT = '연결 확인입니다. "확인"이라고만 답하세요.'

export const isLlmProvider = (value: unknown): value is LlmProvider =>
  typeof value === 'string' && (LLM_PROVIDERS as string[]).includes(value)

export const isLlmApiVendor = (value: unknown): value is LlmApiVendor =>
  typeof value === 'string' && (LLM_API_VENDORS as string[]).includes(value)

export const isOpenaiModelId = (value: unknown): value is OpenaiModelId =>
  typeof value === 'string' && OPENAI_MODELS.some((model) => model.id === value)

/**
 * @description 공급자가 API 키를 쓰는지, 쓴다면 어느 회사 키인지 알려줍니다. 키 저장·상태·화면이 이 대응 하나를 본다.
 * @param provider - LLM 공급자
 * @returns 회사. 키를 쓰지 않는 공급자(로컬·CLI)는 null
 * @example
 * apiVendorOf('openai-api') // 'openai'
 */
export const apiVendorOf = (provider: LlmProvider): LlmApiVendor | null => {
  if (provider === 'claude-api') return 'anthropic'
  if (provider === 'openai-api') return 'openai'

  return null
}

/**
 * @description 현재 공급자로 요약·초안을 만들 준비가 되어 있지 않을 때 보여줄 한국어 안내를 만듭니다.
 * main(잡 시작 전 확인)과 renderer(버튼 막기)가 같은 문구를 쓴다.
 * @param status - `llm:status` 응답
 * @returns 준비되어 있으면 null
 * @example
 * const message = llmMissingMessage(status) // '로컬 요약 모델 파일이 설치되어 있지 않습니다'
 */
export const llmMissingMessage = (status: LlmStatus) => {
  if (status.provider === 'claude-cli') {
    return status.claudeCliPath ? null : 'Claude Code(claude 명령)를 찾을 수 없습니다'
  }
  if (status.provider === 'codex-cli') {
    if (!status.codexCliPath) return 'Codex CLI(codex 명령)를 찾을 수 없습니다'
    return status.isCodexCliSandboxSupported
      ? null
      : (status.codexCliUnsupportedReason ??
          'Codex CLI가 회의록 분석에 필요한 무도구 실행 모드를 지원하는지 확인되지 않았습니다')
  }

  const vendor = apiVendorOf(status.provider)
  if (vendor) {
    return status.apiKeys[vendor].isSaved
      ? null
      : `${LLM_API_KEY_LABELS[vendor]}가 저장되어 있지 않습니다`
  }

  return status.isLocalModelReady ? null : '로컬 요약 모델 파일이 설치되어 있지 않습니다'
}

/**
 * @description 현재 공급자로 LLM을 부를 수 있는지 판정합니다.
 * @param status - `llm:status` 응답
 * @returns 준비 여부
 * @example
 * if (!isLlmReady(status)) disableButton()
 */
export const isLlmReady = (status: LlmStatus) => llmMissingMessage(status) === null

/**
 * @description `claude -p` 인자를 만듭니다. 프롬프트는 argv가 아니라 stdin으로 넘기므로 여기에 없다.
 * `--bare`는 키체인을 읽지 않아 구독 로그인이 풀리므로 쓰지 않는다 (references/pitfalls.md).
 * @param system - 시스템 프롬프트 (수백 자라 argv로 충분하다)
 * @returns spawn에 넘길 인자 배열
 * @example
 * runBinary({ command: claudePath, args: buildClaudeCliArgs({ system }), input: prompt })
 */
export const buildClaudeCliArgs = ({ system }: { system: string }) => [
  '-p',
  '--output-format',
  'json',
  // 도구를 전부 끈다. 요약은 한 턴짜리 텍스트 생성이라 파일·셸 접근이 필요 없다
  '--tools',
  '',
  '--mcp-config',
  '{"mcpServers":{}}',
  '--strict-mcp-config',
  '--safe-mode',
  '--no-session-persistence',
  // 사용자·프로젝트 설정(훅·플러그인)을 섞지 않는다
  '--setting-sources',
  '',
  '--system-prompt',
  system
]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/** stdout 앞뒤에 로그가 섞여도 첫 `{`부터 마지막 `}`까지를 JSON으로 본다 */
const extractJson = (stdout: string) => {
  const start = stdout.indexOf('{')
  const end = stdout.lastIndexOf('}')
  if (start < 0 || end <= start) return null

  try {
    return JSON.parse(stdout.slice(start, end + 1)) as unknown
  } catch {
    return null
  }
}

const redactCliMessage = (message: string) =>
  message
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, 'sk-***')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '***@***')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)

const claudeCliErrorText = ({ stdout, stderr }: { stdout: string; stderr: string }) => {
  const parsed = extractJson(stdout)
  const result =
    isRecord(parsed) && typeof parsed.result === 'string' && parsed.result.trim()
      ? parsed.result
      : ''
  const stderrText = stderr.trim()

  return [result, stderrText].filter(Boolean).join('\n')
}

/**
 * @description Claude Code CLI 실패 원인을 사용자가 다음 행동을 알 수 있는 문장으로 바꿉니다.
 * 원문 stdout/stderr 파일은 main 쪽 BinaryExecutionError에 그대로 남기고, 화면에는 짧고 안전한
 * 분류 메시지만 보여 준다.
 */
export const claudeCliFailureMessage = ({
  stdout,
  stderr,
  fallbackMessage
}: {
  stdout: string
  stderr: string
  fallbackMessage: string
}) => {
  const raw = claudeCliErrorText({ stdout, stderr })
  const detail = redactCliMessage(raw)
  const normalized = raw.toLowerCase()

  if (
    /not logged in|please run \/login|login required|authentication required|unauthorized|invalid api key|401/.test(
      normalized
    )
  ) {
    return 'Claude Code 로그인이 필요합니다. 터미널에서 Claude Code에 로그인한 뒤 앱의 AI 모델 설정에서 연결 확인을 다시 눌러 주세요.'
  }

  if (
    /rate limit|quota|too many requests|429|credit balance|billing|usage limit/.test(normalized)
  ) {
    return 'Claude Code 사용량 제한이나 결제 한도 때문에 요청이 중단됐습니다. 잠시 뒤 다시 시도하거나 다른 AI 모델을 선택해 주세요.'
  }

  if (
    /unknown option|unrecognized option|invalid option|no such option|unexpected argument|unknown command/.test(
      normalized
    )
  ) {
    return '현재 설치된 Claude Code가 회의록 분석에 필요한 안전 실행 옵션을 지원하지 않습니다. Claude Code를 최신 버전으로 업데이트한 뒤 다시 시도해 주세요.'
  }

  if (
    /network|enotfound|econnreset|etimedout|eai_again|socket|dns|tls|certificate|connection/.test(
      normalized
    )
  ) {
    return 'Claude Code가 네트워크 요청을 완료하지 못했습니다. 인터넷 연결이나 회사·학교 네트워크 차단 여부를 확인한 뒤 다시 시도해 주세요.'
  }

  if (/permission denied|eacces/.test(normalized)) {
    return 'Claude Code 실행 권한이 없습니다. claude 명령 파일의 실행 권한을 확인한 뒤 다시 시도해 주세요.'
  }

  if (detail) return `Claude Code 실행에 실패했습니다: ${detail}`

  return fallbackMessage
}

/**
 * @description `claude -p --output-format json`의 stdout에서 답변 본문을 꺼냅니다.
 * 종료 코드가 0이어도 `is_error`가 참이면 실패이므로 한국어 안내와 원문을 함께 던진다.
 * @param stdout - CLI 표준 출력 전체
 * @returns 답변 텍스트
 * @example
 * const answer = parseClaudeCliOutput(stdout)
 */
export const parseClaudeCliOutput = (stdout: string) => {
  const parsed = extractJson(stdout)
  if (!isRecord(parsed) || parsed.type !== 'result') {
    throw new Error('Claude Code 결과를 읽지 못했습니다 (출력 형식이 예상과 다릅니다)')
  }

  const result = typeof parsed.result === 'string' ? parsed.result : ''
  if (parsed.is_error === true) {
    throw new Error(
      claudeCliFailureMessage({
        stdout,
        stderr: '',
        fallbackMessage: `Claude Code가 요청을 처리하지 못했습니다: ${result || '원인 불명'}`
      })
    )
  }

  return result
}

/**
 * @description 화면에 보여줄 키 꼬리를 만듭니다. 키 전체는 renderer로 보내지 않는다.
 * @param apiKey - 복호화한 키
 * @returns 마지막 4자
 * @example
 * apiKeyTailOf('sk-ant-api03-…wxyz') // 'wxyz'
 */
export const apiKeyTailOf = (apiKey: string) => apiKey.slice(-API_KEY_TAIL_CHARS)

/**
 * @description renderer가 보낸 API 키 요청을 검증합니다. 모르는 회사·빈 값·너무 긴 값·줄바꿈이 섞인 값은 거절한다.
 * @param payload - `llm:setApiKey` 요청 payload
 * @returns 회사와 앞뒤 공백을 자른 키. `apiKey`가 `null`이면 삭제 요청
 * @example
 * const { vendor, apiKey } = readApiKeyPayload(payload)
 */
export const readApiKeyPayload = (payload: unknown) => {
  if (!isRecord(payload) || !isLlmApiVendor(payload.vendor)) {
    throw new Error('잘못된 요청입니다 (API 키 회사 없음)')
  }
  if (!('apiKey' in payload)) throw new Error('잘못된 요청입니다 (API 키 없음)')

  const { vendor } = payload
  if (payload.apiKey === null) return { vendor, apiKey: null }
  if (typeof payload.apiKey !== 'string') throw new Error('잘못된 요청입니다 (API 키 형식 오류)')

  const apiKey = payload.apiKey.trim()
  if (!apiKey) throw new Error('API 키를 입력해 주세요')
  if (apiKey.length > API_KEY_MAX_CHARS || /\s/.test(apiKey)) {
    throw new Error('API 키 형식이 아닙니다. 콘솔에서 복사한 키를 그대로 붙여 넣어 주세요')
  }

  return { vendor, apiKey }
}
