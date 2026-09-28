import OpenAI from 'openai'
import type { OpenaiModelId } from '@shared/types'
import { API_MIN_MAX_TOKENS } from '@shared/llm'

/** 요약·초안은 정형 작업이라 깊은 추론이 필요 없다 (references/architecture.md "OpenAI API 호출") */
const REASONING_EFFORT = 'low'

interface CompleteWithOpenaiApiParams {
  apiKey: string
  model: OpenaiModelId
  system: string
  prompt: string
  maxTokens: number
}

/** SDK 오류를 사용자에게 보여줄 한국어 안내로 바꾼다. 구체적인 것부터 본다 */
const toUserError = (caught: unknown) => {
  if (caught instanceof OpenAI.AuthenticationError) {
    return new Error('OpenAI API 키가 올바르지 않습니다. 설정에서 키를 다시 저장해 주세요')
  }
  if (caught instanceof OpenAI.RateLimitError) {
    return new Error('OpenAI API 요청 한도나 잔액이 부족합니다. 잠시 뒤 다시 시도해 주세요')
  }
  if (caught instanceof OpenAI.APIConnectionError) {
    return new Error('OpenAI 서버에 연결할 수 없습니다. 네트워크를 확인해 주세요')
  }
  if (caught instanceof OpenAI.APIError) {
    return new Error(`OpenAI API 오류 (${caught.status ?? '알 수 없음'}): ${caught.message}`)
  }

  return caught instanceof Error ? caught : new Error(String(caught))
}

/**
 * Responses API를 한 번 부른다. HTTP 200이어도 `status: 'incomplete'`면 본문이 잘려 있으므로
 * 이유를 나눠 오류로 바꾼다 (references/pitfalls.md).
 */
export const completeWithOpenaiApi = async ({
  apiKey,
  model,
  system,
  prompt,
  maxTokens
}: CompleteWithOpenaiApiParams) => {
  const client = new OpenAI({ apiKey })

  try {
    const response = await client.responses.create({
      model,
      instructions: system,
      input: prompt,
      // 추론 토큰이 여기에 포함되므로 로컬용 상한을 그대로 쓰지 않는다
      max_output_tokens: Math.max(maxTokens, API_MIN_MAX_TOKENS),
      reasoning: { effort: REASONING_EFFORT }
    })

    if (response.status === 'incomplete') {
      const reason = response.incomplete_details?.reason
      if (reason === 'content_filter') throw new Error('GPT가 이 요청을 처리하지 않았습니다')

      throw new Error('GPT 답변이 길어 잘렸습니다. 회의록을 나눠 다시 시도해 주세요')
    }

    return response.output_text
  } catch (caught) {
    throw toUserError(caught)
  }
}
