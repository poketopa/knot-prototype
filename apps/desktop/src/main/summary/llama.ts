import { GLOSSARY_CTX_TOKENS, GLOSSARY_MAX_PREDICT_TOKENS } from '@shared/glossary'
import { cleanSummary, SUMMARY_CTX_TOKENS, SUMMARY_MAX_PREDICT_TOKENS } from '@shared/summary'

/** 요약은 창작이 아니므로 낮게 둔다. 0으로 두면 같은 문장을 반복하는 경향이 있다 */
export const SUMMARY_TEMPERATURE = 0.3

/** 용어 초안은 목록을 적는 일이라 요약보다 낮춘다. 0.3에서는 읽기가 더 자주 흔들렸다 */
export const GLOSSARY_TEMPERATURE = 0.1

/** llama-cli가 `-o` 파일에 답변 앞에 붙이는 고정 표시 */
const ASSISTANT_MARKER = '\nAssistant:\n'

interface LlamaFilesParams {
  modelPath: string
  systemPromptPath: string
  promptPath: string
  outputPath: string
  threads: number
}

export interface BuildLlamaArgsParams extends LlamaFilesParams {
  ctxTokens: number
  maxPredictTokens: number
  temperature: number
  /** 출력 형식을 못박는 GBNF 문법 파일 */
  grammarPath?: string
}

/**
 * llama-cli 인자. 프롬프트·시스템 프롬프트·출력을 전부 파일로 주고받는다 —
 * 회의록은 수만 자라 argv에 넣으면 길이 제한에 걸리고, `-e`(기본 켜짐)가 본문의
 * 역슬래시를 제어문자로 바꾼다 (references/architecture.md).
 */
export const buildLlamaArgs = ({
  modelPath,
  systemPromptPath,
  promptPath,
  outputPath,
  threads,
  ctxTokens,
  maxPredictTokens,
  temperature,
  grammarPath
}: BuildLlamaArgsParams) => [
  '-m',
  modelPath,
  '-sysf',
  systemPromptPath,
  '-f',
  promptPath,
  '-o',
  outputPath,
  ...(grammarPath ? ['--grammar-file', grammarPath] : []),
  // 한 턴만 돌고 끝낸다. 대화 모드로 들어가면 stdin을 기다리며 프로세스가 끝나지 않는다
  '-st',
  '--no-escape',
  '--no-display-prompt',
  '--no-warmup',
  '--no-show-timings',
  '-c',
  String(ctxTokens),
  '-n',
  String(maxPredictTokens),
  '--temp',
  String(temperature),
  '-t',
  String(threads)
]

export const buildSummaryArgs = (params: LlamaFilesParams) =>
  buildLlamaArgs({
    ...params,
    ctxTokens: SUMMARY_CTX_TOKENS,
    maxPredictTokens: SUMMARY_MAX_PREDICT_TOKENS,
    temperature: SUMMARY_TEMPERATURE
  })

export const buildGlossaryDraftArgs = (params: LlamaFilesParams & { grammarPath: string }) =>
  buildLlamaArgs({
    ...params,
    ctxTokens: GLOSSARY_CTX_TOKENS,
    maxPredictTokens: GLOSSARY_MAX_PREDICT_TOKENS,
    temperature: GLOSSARY_TEMPERATURE
  })

interface ExtractAnswerParams {
  raw: string
  prompt: string
}

/**
 * `-o` 파일은 `User:\n<프롬프트>\n\nAssistant:\n<답변>` 형식이다.
 * 회의록 본문에도 같은 표시가 있을 수 있으므로 프롬프트가 끝나는 지점부터 찾는다.
 */
export const extractAnswer = ({ raw, prompt }: ExtractAnswerParams) => {
  const body = prompt.trimEnd()
  const promptAt = raw.indexOf(body)
  const searchFrom = promptAt < 0 ? 0 : promptAt + body.length
  const markerAt = raw.indexOf(ASSISTANT_MARKER, searchFrom)

  if (markerAt < 0) {
    throw new Error('llama-cli 결과를 읽지 못했습니다 (출력 형식이 예상과 다릅니다)')
  }

  return raw.slice(markerAt + ASSISTANT_MARKER.length)
}

export const parseSummaryOutput = (params: ExtractAnswerParams) => {
  const summary = cleanSummary(extractAnswer(params))
  if (!summary) throw new Error('요약이 비어 있습니다 (회의록이 너무 짧을 수 있습니다)')

  return summary
}
