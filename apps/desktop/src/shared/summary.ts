/**
 * 로컬 LLM 회의 요약의 순수 로직 — 회의록 분할, 프롬프트 조립, 모델 출력 정리.
 * spawn·파일 IO는 `src/main/summary/*`가 담당한다 (references/architecture.md).
 */

import type {
  TopicAnalysisDocument,
  TopicAnalysisPoint,
  TopicAnalysisResult,
  TopicAnalysisTopic,
  TopicAnalysisUtterance
} from './types'

/**
 * Qwen3 토크나이저로 실측한 한국어 회의록의 문자/토큰 비 (40,089자 → 28,004토큰 = 1.43).
 * 예산을 넘기지 않도록 실측값보다 낮게 잡는다 (docs/phase5-results.md).
 */
const CHARS_PER_TOKEN = 1.4

/**
 * 컨텍스트를 크게 잡으면 KV 캐시가 그만큼 커진다 (Qwen3-4B는 토큰당 약 144KB).
 * 8192토큰이면 1.2GB 수준이라 저사양에서도 뜬다.
 */
export const SUMMARY_CTX_TOKENS = 8192

/**
 * 한 번의 요약이 만들어 낼 최대 토큰. 900으로 두면 71분 회의의 최종 요약이
 * 문장 중간에서 잘렸다 (docs/phase5-results.md).
 */
export const SUMMARY_MAX_PREDICT_TOKENS = 1200

/** 시스템 프롬프트와 지시문이 컨텍스트에서 차지하는 몫 */
const INSTRUCTION_TOKENS = 500

/** 회의록 본문 한 조각이 차지할 수 있는 최대 글자 수 */
export const CHUNK_BUDGET_CHARS = Math.floor(
  (SUMMARY_CTX_TOKENS - SUMMARY_MAX_PREDICT_TOKENS - INSTRUCTION_TOKENS) * CHARS_PER_TOKEN
)

/**
 * @description 글자 수로 토큰 수를 어림합니다. 실측 비율 기반이라 정확한 값이 아니라 예산 계산용입니다.
 * @param chars - 글자 수
 * @returns 어림한 토큰 수
 * @example
 * const tokens = estimateTokens({ chars: transcript.length })
 */
export const estimateTokens = ({ chars }: { chars: number }) => Math.ceil(chars / CHARS_PER_TOKEN)

/**
 * 요약이 사실을 지어내지 않도록 붙이는 시스템 프롬프트.
 * 날짜를 따로 못박는 이유: 초안에서 회의록에 없는 기한("2025년 4월 10일")을 만들어 냈다
 * (docs/phase5-results.md).
 */
export const SUMMARY_SYSTEM_PROMPT = [
  '당신은 한국어 회의록을 요약하는 도우미입니다.',
  '주어진 회의록에 실제로 나온 내용만 사용합니다.',
  '회의록에 없는 날짜·기한·숫자·이름·직책을 새로 만들어 쓰지 않습니다. 근거가 없으면 그 항목을 통째로 빼거나 "없음"이라고 씁니다.',
  '"화자 1", "화자 7" 같은 번호 라벨은 사람 이름이 아닙니다. 담당자로 쓰지 말고, 이름이 분명하지 않으면 담당자를 적지 않습니다.',
  '회의록은 음성 인식 결과라 오탈자가 있을 수 있습니다. 문맥으로 읽되 확실하지 않은 내용은 단정하지 않습니다.',
  '항상 한국어로, 요청받은 형식만 출력합니다. 인사말이나 설명을 덧붙이지 않습니다.'
].join('\n')

const FINAL_FORMAT = [
  '## 핵심 요약',
  '- (가장 중요한 것부터 5개 이내, 한 줄에 하나)',
  '',
  '## 결정 사항',
  '- (회의에서 확정된 것만 5개 이내. 없으면 "없음")',
  '',
  '## 다음 할 일',
  '- (할 일 하나에 한 줄, 5개 이내. 이름이 회의록에 분명히 나온 경우에만 "이름: "을 앞에 붙이고, 아니면 할 일만 적는다. 기한도 회의록에 나온 경우에만 덧붙인다. 없으면 "없음")'
].join('\n')

const CHUNK_FORMAT = [
  '## 논의',
  '- (이 구간에서 다룬 주제와 결론)',
  '',
  '## 결정',
  '- (이 구간에서 확정된 것만. 없으면 "없음")',
  '',
  '## 할 일',
  '- (할 일 하나에 한 줄. 이름이 분명히 나온 경우에만 "이름: "을 앞에 붙인다. 없으면 "없음")'
].join('\n')

interface SplitTranscriptParams {
  text: string
  budgetChars?: number
}

/**
 * @description 회의록을 요약 구간으로 나눕니다. 발화 줄 경계에서만 자르므로 한 발화가 두 구간에 걸치지 않습니다.
 * @param text - 회의록 전문
 * @param budgetChars - 한 구간의 최대 글자 수. 기본값은 `CHUNK_BUDGET_CHARS`
 * @returns 구간 문자열 배열. 빈 회의록이면 빈 배열
 * @example
 * const chunks = splitTranscript({ text: transcript })
 */
export const splitTranscript = ({
  text,
  budgetChars = CHUNK_BUDGET_CHARS
}: SplitTranscriptParams) => {
  const lines = text.split('\n').filter((line) => line.trim())
  if (!lines.length) return []

  const chunks: string[] = []
  let current: string[] = []
  let length = 0

  for (const line of lines) {
    // 한 줄이 예산보다 길면 쪼갤 경계가 없으므로 그대로 한 구간이 된다
    if (current.length && length + line.length + 1 > budgetChars) {
      chunks.push(current.join('\n'))
      current = []
      length = 0
    }

    current.push(line)
    length += line.length + 1
  }

  if (current.length) chunks.push(current.join('\n'))

  return chunks
}

/**
 * @description 회의록 전체가 한 번에 들어갈 때 쓰는 요약 프롬프트를 만듭니다.
 * @param transcript - 회의록 전문
 * @returns llama-cli에 파일로 넘길 프롬프트
 * @example
 * const prompt = buildWholePrompt({ transcript })
 */
export const buildWholePrompt = ({ transcript }: { transcript: string }) =>
  [
    '아래는 회의록 전문입니다.',
    '',
    transcript,
    '',
    '위 회의록을 다음 형식으로 요약하세요.',
    '',
    FINAL_FORMAT
  ].join('\n')

interface BuildChunkPromptParams {
  chunk: string
  index: number
  total: number
}

/**
 * @description 긴 회의록의 한 구간을 부분 요약하는 프롬프트를 만듭니다 (map 단계).
 * @param chunk - 구간 본문
 * @param index - 0부터 시작하는 구간 번호
 * @param total - 전체 구간 수
 * @returns llama-cli에 파일로 넘길 프롬프트
 * @example
 * const prompt = buildChunkPrompt({ chunk, index: 0, total: 5 })
 */
export const buildChunkPrompt = ({ chunk, index, total }: BuildChunkPromptParams) =>
  [
    `아래는 회의록 전체 ${total}개 구간 중 ${index + 1}번째 구간입니다.`,
    '앞뒤 구간은 보이지 않으므로, 이 구간에 실제로 나온 내용만 정리하세요.',
    '',
    chunk,
    '',
    '이 구간을 다음 형식으로 정리하세요.',
    '',
    CHUNK_FORMAT
  ].join('\n')

/**
 * @description 부분 요약들을 하나의 회의 요약으로 합치는 프롬프트를 만듭니다 (reduce 단계).
 * @param partials - `buildChunkPrompt`로 얻은 구간별 부분 요약
 * @returns llama-cli에 파일로 넘길 프롬프트
 * @example
 * const prompt = buildReducePrompt({ partials })
 */
export const buildReducePrompt = ({ partials }: { partials: string[] }) =>
  [
    '아래는 한 회의를 구간별로 나눠 정리한 부분 요약입니다.',
    '',
    partials.map((partial, index) => `### 구간 ${index + 1}\n${partial}`).join('\n\n'),
    '',
    '부분 요약들을 하나의 회의 요약으로 합치세요.',
    '중복되는 항목은 하나로 묶고, 구간 번호는 결과에 남기지 마세요.',
    '',
    FINAL_FORMAT
  ].join('\n')

const CODE_FENCE = /^```[a-z]*\n([\s\S]*?)\n```$/

/**
 * @description 모델 출력에서 코드펜스·줄 끝 공백·과한 빈 줄을 걷어냅니다.
 * @param raw - 모델이 만든 원본 텍스트
 * @returns 화면과 DB에 그대로 쓸 요약 텍스트
 * @example
 * const summary = cleanSummary(raw)
 */
export const cleanSummary = (raw: string) => {
  const trimmed = raw.trim()
  const unfenced = CODE_FENCE.exec(trimmed)?.[1] ?? trimmed

  return unfenced
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export const TOPIC_ANALYSIS_PROMPT_VERSION = 'topic-analysis-v1'

/** 구조화 결과에는 요약문보다 많은 출력 공간이 필요하다. */
export const TOPIC_ANALYSIS_MAX_PREDICT_TOKENS = 3000

/** 시스템·문서 목록·형식 지시까지 포함한 로컬 입력 예산. */
export const TOPIC_ANALYSIS_LOCAL_INPUT_CHARS = Math.floor(
  (SUMMARY_CTX_TOKENS - TOPIC_ANALYSIS_MAX_PREDICT_TOKENS - 256) * CHARS_PER_TOKEN
)

/** 내용 검증은 parseTopicAnalysis가 맡고, 로컬 모델의 출력은 JSON 객체로 제한한다. */
export const TOPIC_ANALYSIS_JSON_GRAMMAR = String.raw`root ::= object
object ::= "{" ws (string ws ":" ws value (ws "," ws string ws ":" ws value)*)? ws "}"
array ::= "[" ws (value (ws "," ws value)*)? ws "]"
value ::= object | array | string | number | "true" | "false" | "null"
string ::= "\"" ([^"\\\x00-\x1F] | "\\" (["\\/bfnrt] | "u" [0-9a-fA-F]{4}))* "\""
number ::= "-"? ("0" | [1-9] [0-9]*) ("." [0-9]+)? ([eE] [+-]? [0-9]+)?
ws ::= [ \t\n\r]*`

export const TOPIC_ANALYSIS_SYSTEM_PROMPT = [
  '당신은 한국어 회의록에서 주제별 결정 사항을 구조화하는 도우미입니다.',
  '회의록에 실제로 나온 내용만 사용합니다.',
  '회의에서 확정된 결정과 아직 미결정인 사항을 반드시 구분합니다.',
  '한 회의에서 여러 주제가 나오면 주제마다 별도 topic으로 나눕니다.',
  '기존 문서 목록에 같은 주제가 있으면 existingDocumentId를 사용하고, 새 주제면 existingDocumentId와 newDocumentId를 모두 null로 둡니다.',
  '새 문서 UUID는 절대 만들지 않습니다. 앱이 검증 뒤 배정합니다.',
  '각 결정과 미결정에는 근거가 된 sourceUtteranceIds를 1개 이상 넣습니다.',
  'sourceUtteranceIds에는 회의록의 SOURCE_ID 값만 사용합니다. time 값이나 speaker 값은 넣지 않습니다.',
  'SOURCE_ID와 기존 문서 id는 입력으로 받은 값만 사용합니다.',
  '어떤 주제를 오늘 논의하지 않았다는 언급만 있으면 그 주제의 topic을 만들지 않습니다.',
  '논의할 내용이 없으면 topics를 빈 배열로 둡니다.',
  '항상 JSON만 출력합니다. 설명, 인사말, 코드펜스를 붙이지 않습니다.'
].join('\n')

const TOPIC_ANALYSIS_SCHEMA_TEXT = [
  '{',
  '  "schemaVersion": 1,',
  '  "topics": [',
  '    {',
  '      "existingDocumentId": "기존 문서 UUID 또는 null",',
  '      "newDocumentId": null,',
  '      "title": "주제 제목",',
  '      "overview": "이번 회의에서 이 주제를 어떻게 다뤘는지 한두 문장",',
  '      "decisions": [{"text": "확정된 결정", "sourceUtteranceIds": ["S001"]}],',
  '      "unresolved": [{"text": "미결정 사항", "sourceUtteranceIds": ["S002"]}]',
  '    }',
  '  ]',
  '}'
].join('\n')

const formatSeconds = (value?: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''

  const total = Math.max(0, Math.floor(value))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60

  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

const sourceAliasForIndex = (index: number) => `S${(index + 1).toString().padStart(3, '0')}`

const topicAnalysisSourceAliases = (utterances: TopicAnalysisUtterance[]) => {
  const aliases = new Map<string, string>()
  const originalIds = new Set<string>()

  utterances.forEach((utterance, index) => {
    aliases.set(sourceAliasForIndex(index), utterance.id)
    originalIds.add(utterance.id)
  })

  return { aliases, originalIds }
}

export const formatTopicAnalysisTranscript = ({
  utterances
}: {
  utterances: TopicAnalysisUtterance[]
}) =>
  utterances
    .map((utterance, index) => {
      const time = formatSeconds(utterance.startSec)
      const fields = [`SOURCE_ID=${sourceAliasForIndex(index)}`]
      if (time) fields.push(`time=${time}`)
      fields.push(`speaker=${utterance.speakerLabel}`)
      fields.push(`text=${utterance.text}`)

      return fields.join(' | ')
    })
    .join('\n')

export const splitTopicAnalysisUtterances = ({
  utterances,
  budgetChars = CHUNK_BUDGET_CHARS
}: {
  utterances: TopicAnalysisUtterance[]
  budgetChars?: number
}) => {
  const lines = utterances.map((utterance) => ({
    utterance,
    text: formatTopicAnalysisTranscript({ utterances: [utterance] })
  }))
  if (!lines.length) return []

  const chunks: TopicAnalysisUtterance[][] = []
  let current: TopicAnalysisUtterance[] = []
  let length = 0

  for (const line of lines) {
    // 긴 한 발화도 원래 근거 id를 유지하며 분할한다. 본문을 버리거나 잘라내지 않는다.
    const overhead = line.text.length - line.utterance.text.length + 1
    const textBudget = Math.max(1, budgetChars - overhead)
    if (line.text.length + 1 > budgetChars && line.utterance.text.length > textBudget) {
      if (current.length) {
        chunks.push(current)
        current = []
        length = 0
      }
      for (let offset = 0; offset < line.utterance.text.length;) {
        let end = Math.min(line.utterance.text.length, offset + textBudget)
        const last = line.utterance.text.charCodeAt(end - 1)
        if (last >= 0xd800 && last <= 0xdbff && end < line.utterance.text.length) end -= 1
        if (end === offset) end += 2
        chunks.push([{ ...line.utterance, text: line.utterance.text.slice(offset, end) }])
        offset = end
      }
      continue
    }
    if (current.length && length + line.text.length + 1 > budgetChars) {
      chunks.push(current)
      current = []
      length = 0
    }

    current.push(line.utterance)
    length += line.text.length + 1
  }

  if (current.length) chunks.push(current)

  return chunks
}

const formatDocumentCatalog = ({ documents }: { documents: TopicAnalysisDocument[] }) => {
  if (!documents.length) return '기존 문서 없음'

  return documents
    .map((document) => {
      const overview = document.overview?.trim()

      return `- ${document.id}: ${document.title}${overview ? ` — ${overview}` : ''}`
    })
    .join('\n')
}

export const assertTopicCatalogFits = ({
  documents,
  budgetChars
}: {
  documents: TopicAnalysisDocument[]
  budgetChars: number
}) => {
  const catalog = formatDocumentCatalog({ documents })
  if (catalog.length > budgetChars) {
    throw new Error('기존 문서 목록이 너무 커서 AI 분석 입력에 모두 넣을 수 없습니다')
  }
}

interface BuildTopicPromptParams {
  utterances: TopicAnalysisUtterance[]
  documents: TopicAnalysisDocument[]
}

export const buildTopicWholePrompt = ({ utterances, documents }: BuildTopicPromptParams) =>
  [
    '아래 기존 문서 목록과 회의록을 보고 주제별 결정/미결정을 JSON으로 출력하세요.',
    'sourceUtteranceIds에는 각 줄의 SOURCE_ID만 넣으세요. time 값(예: 00:00:00)은 근거 id가 아닙니다.',
    '',
    '## 기존 문서 목록',
    formatDocumentCatalog({ documents }),
    '',
    '## 회의록',
    formatTopicAnalysisTranscript({ utterances }),
    '',
    '## 출력 JSON 형식',
    TOPIC_ANALYSIS_SCHEMA_TEXT
  ].join('\n')

export const buildTopicChunkPrompt = ({
  utterances,
  documents,
  index,
  total
}: BuildTopicPromptParams & { index: number; total: number }) =>
  [
    `아래는 회의록 전체 ${total}개 구간 중 ${index + 1}번째 구간입니다.`,
    '이 구간에 실제로 나온 주제별 결정/미결정만 JSON으로 출력하세요.',
    'sourceUtteranceIds에는 각 줄의 SOURCE_ID만 넣으세요. time 값(예: 00:00:00)은 근거 id가 아닙니다.',
    '',
    '## 기존 문서 목록',
    formatDocumentCatalog({ documents }),
    '',
    '## 회의록 구간',
    formatTopicAnalysisTranscript({ utterances }),
    '',
    '## 출력 JSON 형식',
    TOPIC_ANALYSIS_SCHEMA_TEXT
  ].join('\n')

export const buildTopicReducePrompt = ({
  partials,
  documents,
  utterances = []
}: {
  partials: TopicAnalysisResult[]
  documents: TopicAnalysisDocument[]
  utterances?: TopicAnalysisUtterance[]
}) => {
  const sourceAliasesByOriginalId = new Map(
    utterances.map((utterance, index) => [utterance.id, sourceAliasForIndex(index)])
  )
  const modelVisibleSourceIds = (sourceUtteranceIds: string[]) =>
    sourceUtteranceIds.map((sourceId) => sourceAliasesByOriginalId.get(sourceId) ?? sourceId)
  const modelVisiblePartials = partials.map((partial) => ({
    ...partial,
    topics: partial.topics.map((topic) => ({
      ...topic,
      newDocumentId: null,
      decisions: topic.decisions.map((point) => ({
        ...point,
        sourceUtteranceIds: modelVisibleSourceIds(point.sourceUtteranceIds)
      })),
      unresolved: topic.unresolved.map((point) => ({
        ...point,
        sourceUtteranceIds: modelVisibleSourceIds(point.sourceUtteranceIds)
      }))
    }))
  }))

  return [
    '아래는 한 회의를 구간별로 분석한 JSON입니다.',
    '중복되는 기존 문서 topic은 하나로 합치고, 앞 구간의 제안이 뒤 구간에서 확정되면 최종 상태에 맞춰 decisions/unresolved를 정리하세요.',
    'newDocumentId는 모두 null로 유지하세요. 새 문서 UUID는 앱이 최종 검증 뒤 배정합니다.',
    'sourceUtteranceIds는 SOURCE_ID 형식(S001, S002...)으로 보존하고, 입력에 없는 id를 만들지 마세요.',
    '입력의 모든 결정/미결정과 그 sourceUtteranceIds를 빠뜨리지 말고 결과에 반영하세요.',
    '앞 구간의 미결정이 뒤 구간에서 확정되면 해당 미결정을 unresolved에서 빼고, 이전 논의와 최종 결정의 모든 sourceUtteranceIds를 합쳐 decisions에 넣으세요.',
    '',
    '## 기존 문서 목록',
    formatDocumentCatalog({ documents }),
    '',
    '## 구간별 분석',
    JSON.stringify({ schemaVersion: 1, partials: modelVisiblePartials }),
    '',
    '## 출력 JSON 형식',
    TOPIC_ANALYSIS_SCHEMA_TEXT
  ].join('\n')
}

const JSON_OBJECT = /\{[\s\S]*\}/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const readJsonObject = (raw: string) => {
  const trimmed = raw.trim()
  const unfenced = CODE_FENCE.exec(trimmed)?.[1] ?? trimmed
  const jsonText = JSON_OBJECT.exec(unfenced)?.[0]
  if (!jsonText) {
    throw new Error(
      unfenced.startsWith('{')
        ? 'AI 분석 결과가 끝까지 생성되지 않았습니다. 원본 응답은 보관되어 있습니다'
        : 'AI 분석 결과가 JSON 객체가 아닙니다. 원본 응답은 보관되어 있습니다'
    )
  }

  try {
    return JSON.parse(jsonText) as unknown
  } catch {
    throw new Error('AI 분석 결과 JSON을 파싱하지 못했습니다')
  }
}

const readString = ({ value, label }: { value: unknown; label: string }) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`AI 분석 결과의 ${label} 값이 비어 있습니다`)
  }

  return value.trim()
}

const readNullableString = ({ value, label }: { value: unknown; label: string }) => {
  if (value === null) return null
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`AI 분석 결과의 ${label} 값이 잘못됐습니다`)
  }

  return value.trim()
}

const readPoint = ({
  value,
  sourceAliases,
  originalUtteranceIds,
  label
}: {
  value: unknown
  sourceAliases: Map<string, string>
  originalUtteranceIds: Set<string>
  label: string
}): TopicAnalysisPoint => {
  if (!isRecord(value)) throw new Error(`AI 분석 결과의 ${label} 항목이 객체가 아닙니다`)

  const sourceIds = value.sourceUtteranceIds
  if (!Array.isArray(sourceIds) || !sourceIds.length) {
    throw new Error(`AI 분석 결과의 ${label} 항목에 근거 발화가 없습니다`)
  }

  const rawSourceIds = [
    ...new Set(
      sourceIds.map((sourceId) => readString({ value: sourceId, label: 'sourceUtteranceIds' }))
    )
  ]
  const uniqueSourceIds = rawSourceIds.map((sourceId) => {
    const originalId = sourceAliases.get(sourceId)
    if (originalId) return originalId
    if (originalUtteranceIds.has(sourceId)) return sourceId

    throw new Error(`AI 분석 결과가 알 수 없는 발화 id를 참조했습니다: ${sourceId}`)
  })

  return {
    text: readString({ value: value.text, label: `${label}.text` }),
    sourceUtteranceIds: [...new Set(uniqueSourceIds)]
  }
}

const readPoints = ({
  value,
  sourceAliases,
  originalUtteranceIds,
  label
}: {
  value: unknown
  sourceAliases: Map<string, string>
  originalUtteranceIds: Set<string>
  label: string
}) => {
  if (!Array.isArray(value)) throw new Error(`AI 분석 결과의 ${label} 배열이 없습니다`)

  return value.map((point, index) =>
    readPoint({ value: point, sourceAliases, originalUtteranceIds, label: `${label}[${index}]` })
  )
}

interface NormalizeTopicAnalysisParams {
  raw: string
  utterances: TopicAnalysisUtterance[]
  documents: TopicAnalysisDocument[]
  createDocumentId?: () => string
}

export const parseTopicAnalysis = ({
  raw,
  utterances,
  documents,
  createDocumentId
}: NormalizeTopicAnalysisParams): TopicAnalysisResult => {
  const parsed = readJsonObject(raw)
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.topics)) {
    throw new Error('AI 분석 결과 schemaVersion/topics 형식이 맞지 않습니다')
  }

  const { aliases: sourceAliases, originalIds: originalUtteranceIds } =
    topicAnalysisSourceAliases(utterances)
  const knownDocumentIds = new Set(documents.map((document) => document.id))
  const normalizedTopics: TopicAnalysisTopic[] = []

  for (const [index, rawTopic] of parsed.topics.entries()) {
    if (!isRecord(rawTopic)) throw new Error(`AI 분석 결과 topics[${index}] 항목이 객체가 아닙니다`)

    const existingDocumentId = readNullableString({
      value: rawTopic.existingDocumentId,
      label: `topics[${index}].existingDocumentId`
    })
    const modelNewDocumentId = readNullableString({
      value: rawTopic.newDocumentId,
      label: `topics[${index}].newDocumentId`
    })
    if (existingDocumentId && modelNewDocumentId) {
      throw new Error(`AI 분석 결과 topics[${index}]가 기존 문서와 새 문서를 동시에 지정했습니다`)
    }
    if (modelNewDocumentId) {
      throw new Error(`AI 분석 결과 topics[${index}]가 새 문서 id를 직접 만들었습니다`)
    }
    if (existingDocumentId && !knownDocumentIds.has(existingDocumentId)) {
      throw new Error(`AI 분석 결과가 알 수 없는 문서 id를 참조했습니다: ${existingDocumentId}`)
    }
    const assignedNewDocumentId: string | null = existingDocumentId
      ? null
      : (createDocumentId?.() ?? null)
    if (!existingDocumentId && !assignedNewDocumentId) {
      throw new Error('새 문서 id 생성기가 없어 AI 분석 결과를 확정할 수 없습니다')
    }

    normalizedTopics.push({
      existingDocumentId,
      newDocumentId: assignedNewDocumentId,
      title: readString({ value: rawTopic.title, label: `topics[${index}].title` }),
      overview: readString({ value: rawTopic.overview, label: `topics[${index}].overview` }),
      decisions: readPoints({
        value: rawTopic.decisions,
        sourceAliases,
        originalUtteranceIds,
        label: `topics[${index}].decisions`
      }),
      unresolved: readPoints({
        value: rawTopic.unresolved,
        sourceAliases,
        originalUtteranceIds,
        label: `topics[${index}].unresolved`
      })
    })
  }

  return { schemaVersion: 1, topics: mergeTopicAnalysisTopics(normalizedTopics) }
}

export const mergeTopicAnalysisTopics = (topics: TopicAnalysisTopic[]) => {
  const merged = new Map<string, TopicAnalysisTopic>()
  const ordered: TopicAnalysisTopic[] = []

  for (const topic of topics) {
    const key = topic.existingDocumentId ?? topic.newDocumentId
    if (!key || !merged.has(key)) {
      const copy = {
        ...topic,
        decisions: [...topic.decisions],
        unresolved: [...topic.unresolved]
      }
      ordered.push(copy)
      if (key) merged.set(key, copy)
      continue
    }

    const current = merged.get(key) as TopicAnalysisTopic
    current.overview = [current.overview, topic.overview].filter(Boolean).join('\n')
    current.decisions.push(...topic.decisions)
    current.unresolved.push(...topic.unresolved)
  }

  return ordered
}
