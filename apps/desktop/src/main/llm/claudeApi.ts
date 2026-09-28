import Anthropic from '@anthropic-ai/sdk'
import { API_MIN_MAX_TOKENS, CLAUDE_API_MODEL_ID } from '@shared/llm'

/** 요약·초안은 정형 작업이라 높은 노력이 필요 없다 (references/architecture.md "Claude API 호출") */
const EFFORT = 'medium'

interface CompleteWithClaudeApiParams {
  apiKey: string
  system: string
  prompt: string
  maxTokens: number
}

/** SDK 오류를 사용자에게 보여줄 한국어 안내로 바꾼다. 구체적인 것부터 본다 */
const toUserError = (caught: unknown) => {
  if (caught instanceof Anthropic.AuthenticationError) {
    return new Error('Claude API 키가 올바르지 않습니다. 설정에서 키를 다시 저장해 주세요')
  }
  if (caught instanceof Anthropic.RateLimitError) {
    return new Error('Claude API 요청 한도에 걸렸습니다. 잠시 뒤 다시 시도해 주세요')
  }
  if (caught instanceof Anthropic.APIConnectionError) {
    return new Error('Anthropic 서버에 연결할 수 없습니다. 네트워크를 확인해 주세요')
  }
  if (caught instanceof Anthropic.APIError) {
    return new Error(`Claude API 오류 (${caught.status ?? '알 수 없음'}): ${caught.message}`)
  }

  return caught instanceof Error ? caught : new Error(String(caught))
}

/**
 * Messages API를 한 번 부른다. 스트리밍은 화면에 흘리지 않고 긴 출력의 HTTP 타임아웃을 피하는 용도라
 * `finalMessage()`만 쓴다.
 */
export const completeWithClaudeApi = async ({
  apiKey,
  system,
  prompt,
  maxTokens
}: CompleteWithClaudeApiParams) => {
  const client = new Anthropic({ apiKey })

  try {
    const message = await client.messages
      .stream({
        model: CLAUDE_API_MODEL_ID,
        // 적응형 사고 토큰이 여기에 포함되므로 로컬용 상한을 그대로 쓰지 않는다
        max_tokens: Math.max(maxTokens, API_MIN_MAX_TOKENS),
        system,
        messages: [{ role: 'user', content: prompt }],
        thinking: { type: 'adaptive' },
        output_config: { effort: EFFORT }
      })
      .finalMessage()

    if (message.stop_reason === 'refusal') {
      throw new Error('Claude가 이 요청을 처리하지 않았습니다')
    }
    if (message.stop_reason === 'max_tokens') {
      throw new Error('Claude 답변이 길어 잘렸습니다. 회의록을 나눠 다시 시도해 주세요')
    }

    return message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
  } catch (caught) {
    throw toUserError(caught)
  }
}
