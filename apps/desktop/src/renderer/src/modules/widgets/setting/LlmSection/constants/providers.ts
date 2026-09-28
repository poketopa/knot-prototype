import type { LlmApiVendor, LlmProvider } from '@shared/types'
import { LLM_API_KEY_LABELS, LLM_PROVIDER_LABELS } from '@shared/llm'

interface ProviderOptionItem {
  value: LlmProvider
  title: string
  /** 어디서 돌고, 회의록이 어디로 가며, 무엇이 필요한지. 전송 사실은 빼지 않는다 (SKILL.md 1절) */
  description: string
}

export const PROVIDER_OPTIONS: ProviderOptionItem[] = [
  {
    value: 'local',
    title: `${LLM_PROVIDER_LABELS.local} (기본)`,
    description:
      '이 기기에서 llama.cpp로 실행합니다. AI 분석은 기기에서 실행합니다. 원본과 정리 결과는 보관용 서버에 저장합니다. 아래 로컬 요약 모델 파일(약 2.5GB)을 받아야 합니다.'
  },
  {
    value: 'claude-api',
    title: `${LLM_PROVIDER_LABELS['claude-api']} 키`,
    description:
      'Anthropic 콘솔에서 발급한 API 키로 Claude를 호출합니다. 회의록이 Anthropic 서버로 전송되고 토큰 요금이 부과됩니다.'
  },
  {
    value: 'claude-cli',
    title: `${LLM_PROVIDER_LABELS['claude-cli']} (구독)`,
    description:
      '이 컴퓨터에 설치된 Claude Code(claude 명령)를 실행해 로그인한 구독 계정으로 호출합니다. 회의록이 Anthropic 서버로 전송되며 구독 사용량에 포함됩니다.'
  },
  {
    value: 'codex-cli',
    title: 'Codex CLI (사용자 계정)',
    description:
      '이 컴퓨터의 codex 명령과 로그인한 계정을 사용합니다. 회의록이 OpenAI 서버로 전송되며 사용자 계정의 사용량에 포함됩니다.'
  },
  {
    value: 'openai-api',
    title: `${LLM_PROVIDER_LABELS['openai-api']} 키 (GPT)`,
    description:
      'OpenAI 플랫폼에서 발급한 API 키로 GPT를 호출합니다. 회의록이 OpenAI 서버로 전송되고 토큰 요금이 부과됩니다. 모델은 아래에서 고릅니다.'
  }
]

interface ApiKeyFieldCopy {
  label: string
  /** 어디서 발급받는지. 저장된 키가 없을 때 보인다 */
  hint: string
  placeholder: string
}

export const API_KEY_FIELD_COPY: Record<LlmApiVendor, ApiKeyFieldCopy> = {
  anthropic: {
    label: LLM_API_KEY_LABELS.anthropic,
    hint: 'Anthropic 콘솔(console.anthropic.com)에서 발급한 키를 붙여 넣으세요. 키는 이 기기에 암호화해 저장합니다.',
    placeholder: 'sk-ant-…'
  },
  openai: {
    label: LLM_API_KEY_LABELS.openai,
    hint: 'OpenAI 플랫폼(platform.openai.com)에서 발급한 키를 붙여 넣으세요. 키는 이 기기에 암호화해 저장합니다.',
    placeholder: 'sk-proj-…'
  }
}
