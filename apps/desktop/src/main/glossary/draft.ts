import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import {
  buildGlossaryDraftPrompt,
  GLOSSARY_CTX_TOKENS,
  GLOSSARY_DRAFT_GRAMMAR,
  GLOSSARY_MAX_PREDICT_TOKENS,
  GLOSSARY_SYSTEM_PROMPT,
  parseGlossaryDraft,
  prependTeamTerms
} from '@shared/glossary'
import { createLlmClient } from '../llm/provider'
import { info } from '../log'
import { GLOSSARY_TEMPERATURE } from '../summary/llama'

/** 초안 중에만 쓰는 프롬프트·문법·출력 파일 자리. 끝나면 실패해도 지운다 (references/architecture.md) */
const glossaryWorkDir = () => path.join(app.getPath('userData'), 'glossary')

/**
 * GBNF 문법은 llama-cli에만 있다. Claude에는 같은 형식을 지시문으로 붙이고, 형식에 맞지 않는 줄은
 * `parseGlossaryDraft`가 버린다 (references/architecture.md "LLM 공급자").
 */
const FORMAT_INSTRUCTION = [
  '',
  '출력 형식: 한 줄에 `영어 표기 = 한글 읽기` 하나씩, 3~25줄만 씁니다.',
  '번호·설명·빈 줄·코드 블록을 넣지 않고 용어 줄만 출력합니다.'
].join('\n')

/**
 * 팀 소개로 전역 용어 사전 초안을 만든다. 저장하지 않는다 — 모델 초안에는 틀린 읽기와 일반어가 섞여
 * 사용자가 고친 뒤 저장한다 (references/architecture.md "용어 사전").
 */
export const runGlossaryDraft = async ({ teamDescription }: { teamDescription: string }) => {
  const client = await createLlmClient()
  const isLocal = client.provider === 'local'

  const workDir = glossaryWorkDir()
  await mkdir(workDir, { recursive: true })

  try {
    const prompt =
      buildGlossaryDraftPrompt({ teamDescription }) + (isLocal ? '' : FORMAT_INSTRUCTION)
    const answer = await client.complete({
      system: GLOSSARY_SYSTEM_PROMPT,
      prompt,
      maxTokens: GLOSSARY_MAX_PREDICT_TOKENS,
      label: 'draft',
      workDir,
      grammar: isLocal ? GLOSSARY_DRAFT_GRAMMAR : undefined,
      contextTokens: GLOSSARY_CTX_TOKENS,
      temperature: GLOSSARY_TEMPERATURE
    })

    const terms = prependTeamTerms({ terms: parseGlossaryDraft(answer), teamDescription })
    if (!terms.length) {
      throw new Error('용어 초안이 비어 있습니다. 팀 소개를 조금 더 자세히 적어 주세요')
    }
    info(`용어 초안 생성 완료 (${client.provider}, ${terms.length}개)`)

    return terms
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}
