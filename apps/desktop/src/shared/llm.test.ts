import { describe, expect, it } from 'vitest'
import type { LlmStatus } from './types'

import {
  apiVendorOf,
  buildClaudeCliArgs,
  isLlmProvider,
  isLlmReady,
  isOpenaiModelId,
  llmMissingMessage,
  parseClaudeCliOutput,
  readApiKeyPayload
} from './llm'

const statusOf = (overrides: Partial<LlmStatus> = {}): LlmStatus => ({
  provider: 'local',
  isLocalModelReady: true,
  apiKeys: {
    anthropic: { isSaved: false, tail: null },
    openai: { isSaved: false, tail: null }
  },
  openaiModel: 'gpt-6-sol',
  claudeCliPath: null,
  claudeCliVersion: null,
  ...overrides
})

const savedKeys = (overrides: Partial<LlmStatus['apiKeys']> = {}): LlmStatus['apiKeys'] => ({
  anthropic: { isSaved: false, tail: null },
  openai: { isSaved: false, tail: null },
  ...overrides
})

// claude 2.1.281 `claude -p --output-format json` 실제 출력을 짧게 자른 것
const CLI_SUCCESS =
  '{"duration_api_ms":1873,"stop_reason":"end_turn","session_id":"39b2bed2","total_cost_usd":0.11,"is_error":false,"num_turns":1,"subtype":"success","result":"2","type":"result"}'
const CLI_NOT_LOGGED_IN =
  '{"duration_api_ms":0,"stop_reason":"stop_sequence","is_error":true,"num_turns":1,"subtype":"success","api_error_status":null,"result":"Not logged in · Please run /login","type":"result"}'

describe('isLlmProvider', () => {
  it('네 공급자만 인정한다', () => {
    expect(isLlmProvider('local')).toBe(true)
    expect(isLlmProvider('claude-api')).toBe(true)
    expect(isLlmProvider('claude-cli')).toBe(true)
    expect(isLlmProvider('openai-api')).toBe(true)
    expect(isLlmProvider('codex-cli')).toBe(true)
    expect(isLlmProvider('gemini')).toBe(false)
    expect(isLlmProvider(undefined)).toBe(false)
  })
})

describe('isOpenaiModelId', () => {
  it('GPT-6 계열 세 모델만 인정한다', () => {
    expect(isOpenaiModelId('gpt-6-sol')).toBe(true)
    expect(isOpenaiModelId('gpt-6-astra')).toBe(true)
    expect(isOpenaiModelId('gpt-6-luna')).toBe(true)
    expect(isOpenaiModelId('gpt-4o')).toBe(false)
  })
})

describe('apiVendorOf', () => {
  it('키를 쓰는 공급자만 회사를 돌려준다', () => {
    expect(apiVendorOf('claude-api')).toBe('anthropic')
    expect(apiVendorOf('openai-api')).toBe('openai')
    expect(apiVendorOf('claude-cli')).toBeNull()
    expect(apiVendorOf('local')).toBeNull()
  })
})

describe('llmMissingMessage', () => {
  it('로컬은 요약 모델이 없을 때만 막는다', () => {
    expect(llmMissingMessage(statusOf())).toBeNull()
    expect(llmMissingMessage(statusOf({ isLocalModelReady: false }))).toMatch(/요약 모델/)
  })

  it('Claude API는 Anthropic 키가 있어야 한다. 로컬 모델·OpenAI 키는 보지 않는다', () => {
    expect(
      llmMissingMessage(
        statusOf({
          provider: 'claude-api',
          isLocalModelReady: false,
          apiKeys: savedKeys({ openai: { isSaved: true, tail: 'abcd' } })
        })
      )
    ).toMatch(/Claude API 키/)
    expect(
      isLlmReady(
        statusOf({
          provider: 'claude-api',
          isLocalModelReady: false,
          apiKeys: savedKeys({ anthropic: { isSaved: true, tail: 'wxyz' } })
        })
      )
    ).toBe(true)
  })

  it('OpenAI API는 OpenAI 키가 있어야 한다', () => {
    expect(llmMissingMessage(statusOf({ provider: 'openai-api' }))).toMatch(/OpenAI API 키/)
    expect(
      isLlmReady(
        statusOf({
          provider: 'openai-api',
          isLocalModelReady: false,
          apiKeys: savedKeys({ openai: { isSaved: true, tail: 'abcd' } })
        })
      )
    ).toBe(true)
  })

  it('Claude Code는 실행 파일을 찾아야 한다', () => {
    expect(llmMissingMessage(statusOf({ provider: 'claude-cli' }))).toMatch(/claude 명령/)
    expect(
      isLlmReady(statusOf({ provider: 'claude-cli', claudeCliPath: '/Users/me/.local/bin/claude' }))
    ).toBe(true)
  })

  it('Codex CLI는 실행 파일과 무도구 실행 지원이 모두 확인되어야 한다', () => {
    expect(llmMissingMessage(statusOf({ provider: 'codex-cli' }))).toMatch(/codex 명령/)
    expect(
      llmMissingMessage(
        statusOf({
          provider: 'codex-cli',
          codexCliPath: '/opt/homebrew/bin/codex',
          isCodexCliSandboxSupported: false,
          codexCliUnsupportedReason: '도구 비활성화 불가'
        })
      )
    ).toBe('도구 비활성화 불가')
    expect(
      isLlmReady(
        statusOf({
          provider: 'codex-cli',
          codexCliPath: '/opt/homebrew/bin/codex',
          isCodexCliSandboxSupported: true
        })
      )
    ).toBe(true)
  })
})

describe('buildClaudeCliArgs', () => {
  const args = buildClaudeCliArgs({ system: '당신은 요약 도우미입니다.' })

  it('한 턴 출력 모드와 JSON 형식을 켠다', () => {
    expect(args).toContain('-p')
    expect(args[args.indexOf('--output-format') + 1]).toBe('json')
  })

  it('도구·세션 저장·사용자 설정을 끈다', () => {
    expect(args[args.indexOf('--tools') + 1]).toBe('')
    expect(args[args.indexOf('--mcp-config') + 1]).toBe('{"mcpServers":{}}')
    expect(args).toContain('--strict-mcp-config')
    expect(args).toContain('--safe-mode')
    expect(args).toContain('--no-session-persistence')
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('')
  })

  it('구독 로그인이 풀리는 --bare는 쓰지 않는다', () => {
    expect(args).not.toContain('--bare')
  })

  it('시스템 프롬프트를 인자로 넘기고 프롬프트 본문은 넘기지 않는다', () => {
    expect(args[args.indexOf('--system-prompt') + 1]).toBe('당신은 요약 도우미입니다.')
  })
})

describe('parseClaudeCliOutput', () => {
  it('성공 출력에서 답변만 꺼낸다', () => {
    expect(parseClaudeCliOutput(CLI_SUCCESS)).toBe('2')
  })

  it('종료 코드가 0이어도 is_error면 원문을 담아 던진다', () => {
    expect(() => parseClaudeCliOutput(CLI_NOT_LOGGED_IN)).toThrow(/Not logged in/)
  })

  it('앞뒤에 로그가 섞여도 JSON을 찾는다', () => {
    expect(parseClaudeCliOutput(`warning: something\n${CLI_SUCCESS}\n`)).toBe('2')
  })

  it('JSON이 아니면 형식 오류로 던진다', () => {
    expect(() => parseClaudeCliOutput('Segmentation fault')).toThrow(/출력 형식/)
  })
})

describe('readApiKeyPayload', () => {
  it('null은 삭제 요청으로 본다', () => {
    expect(readApiKeyPayload({ vendor: 'openai', apiKey: null })).toEqual({
      vendor: 'openai',
      apiKey: null
    })
  })

  it('앞뒤 공백을 자른다', () => {
    expect(readApiKeyPayload({ vendor: 'anthropic', apiKey: '  sk-ant-api03-abc  ' })).toEqual({
      vendor: 'anthropic',
      apiKey: 'sk-ant-api03-abc'
    })
  })

  it('모르는 회사·빈 값·공백 포함·필드 누락은 거절한다', () => {
    expect(() => readApiKeyPayload({ vendor: 'google', apiKey: 'x' })).toThrow(/회사/)
    expect(() => readApiKeyPayload({ vendor: 'openai', apiKey: '   ' })).toThrow(/입력/)
    expect(() => readApiKeyPayload({ vendor: 'openai', apiKey: 'sk-proj\nabc' })).toThrow(/형식/)
    expect(() => readApiKeyPayload({ vendor: 'openai' })).toThrow(/잘못된 요청/)
  })
})
