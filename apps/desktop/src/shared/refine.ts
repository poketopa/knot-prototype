/**
 * 로컬 LLM 회의록 교정의 순수 로직 (Phase 5-4).
 *
 * 1. 용어 사전의 한글 발음을 구한다 (라틴 문자 용어만 LLM에 묻는다)
 * 2. 코드가 발화의 어절을 발음과 비교해 치환 후보를 넓게 만든다
 * 3. LLM은 후보마다 문맥상 맞는지 O/X만 답한다
 * 4. 통과한 후보를 코드가 치환해 발화별 수정 제안을 만든다 (원문은 사용자가 수락할 때만 바뀐다)
 *
 * LLM에게 발화를 다시 쓰게 하거나 틀린 곳을 직접 찾게 하면 4B 모델이 문장을 자르고 엉뚱한 용어를 넣었다.
 * 판정만 맡기면 출력이 몇 토큰이라 빠르고, 문법으로 형식을 못박을 수 있다 (docs/phase5-refine-results.md).
 * spawn·파일 IO는 호출하는 쪽이 담당한다.
 */

import { needsReading, phoneticSimilarity } from './phonetic'
import type { RefinePair, RefineSource, RefineSuggestion } from './types'

/** 요약과 같은 컨텍스트. KV 캐시가 1.2GB 수준이라 저사양에서도 뜬다 (src/shared/summary.ts) */
export const REFINE_CTX_TOKENS = 8192

/**
 * 후보의 발음 유사도 하한. 실측에서 맞는 쌍은 0.57 이상(카볼↔타볼 0.80, 대포↔배포 0.75)이었고,
 * 0.5로 두면 "서버·대표·새로·배치" 같은 두 글자 일상어가 줄줄이 걸렸다 (docs/phase5-refine-results.md).
 */
export const MIN_PHONETIC_SIMILARITY = 0.55

/** 판정 한 번에 넘기는 후보 수. 후보 한 줄이 문맥 포함 100자 안팎이라 컨텍스트에 넉넉히 들어간다 */
export const VERIFY_BATCH_SIZE = 40

/** 판정 답 한 줄(`[12] O`)은 5토큰 안팎이다 */
export const VERIFY_MAX_PREDICT_TOKENS = VERIFY_BATCH_SIZE * 8

/** 읽기는 용어 수 × 한 줄이라 짧다 */
export const READING_MAX_PREDICT_TOKENS = 400

/** 후보 앞뒤로 모델에게 보여 줄 문맥 글자 수 */
const CONTEXT_CHARS = 40

/**
 * 어절 끝에서 떼어 볼 조사·어미. 글자 수로 무작정 자르면 "오토파이오처럼"이 "오토파이오처"로 잘려
 * 치환 결과가 "오토파일럿럼"이 됐고, "여기에서부" 같은 조각이 후보가 됐다 (docs/phase5-refine-results.md).
 * 긴 것부터 둬야 "이라고"가 "고"보다 먼저 맞는다.
 */
const PARTICLES = [
  '이라고',
  '이라는',
  '으로는',
  '에서는',
  '에서',
  '으로',
  '처럼',
  '이라',
  '라고',
  '라는',
  '까지',
  '부터',
  '에게',
  '한테',
  '이랑',
  '이나',
  '인데',
  '이고',
  '을',
  '를',
  '이',
  '가',
  '은',
  '는',
  '의',
  '에',
  '로',
  '도',
  '만',
  '과',
  '와',
  '랑',
  '나'
]

/** 이보다 짧은 부분은 우연히 발음이 비슷한 경우가 너무 많다 */
const MIN_FROM_CHARS = 2

const APPROVE = 'O'
const REJECT = 'X'

const READING_LINE = /^\s*(.+?)\s*=>\s*(.+?)\s*$/

const VERDICT_LINE = /^\s*\[(\d+)\]\s*([OX])\s*$/

export const READING_SYSTEM_PROMPT = [
  '당신은 외래어·약어를 한국 개발자가 소리 내어 읽는 대로 한글로 적는 도우미입니다.',
  '용어마다 "용어 => 읽기" 형식으로 한 줄에 하나씩 씁니다. 흔히 쓰는 읽기가 여러 개면 쉼표로 이어 3개까지 씁니다.',
  '예시:',
  'tarball => 타볼, 타르볼',
  'GitHub => 깃허브, 기트허브',
  'npm => 엔피엠',
  'Kubernetes => 쿠버네티스, 쿠버네테스'
].join('\n')

/**
 * 판정 기준을 "그 자리에서 뜻이 통하는가" 하나로 좁힌다. "잘못 받아 적었는가"를 물었을 때
 * 4B 모델이 카볼→tarball은 떨어뜨리고 서비스→semver는 붙이는 등 거의 무작위로 답했다.
 */
export const VERIFY_SYSTEM_PROMPT = [
  '당신은 한국어 음성 인식 결과를 검수합니다. 음성 인식은 개발 용어를 발음이 비슷한 엉뚱한 한글로 적는 일이 많습니다.',
  '후보마다 문맥 속 «» 안의 말을 봅니다.',
  `«» 안의 말이 그 자리에서 뜻이 통하는 한국어 단어나 표현이면 ${REJECT}입니다.`,
  `«» 안의 말이 그 자리에서 뜻이 통하지 않고, 제시된 용어로 바꾸면 문장이 자연스러워지면 ${APPROVE}입니다.`,
  `모든 후보에 "[번호] ${APPROVE}" 또는 "[번호] ${REJECT}"로 답합니다.`
].join('\n')

/** 용어 사전 한 줄의 "용어 = 읽기1, 읽기2" 구분자. 읽기를 적으면 모델에게 묻지 않는다 */
const READING_SEPARATOR = '='

const entryOf = (line: string) => {
  const [term, readings = ''] = line.split(READING_SEPARATOR)
  return {
    term: term.trim(),
    readings: readings
      .split(',')
      .map((reading) => reading.trim())
      .filter(Boolean)
  }
}

const entriesOf = (glossary: string[]) =>
  glossary
    .map(entryOf)
    .filter(({ term }) => term)
    .filter((entry, index, all) => all.findIndex((other) => other.term === entry.term) === index)

/** 한글 발음을 모델에게 물어야 하는 용어 — 라틴 문자 등이 섞였고 사용자가 읽기를 적지 않은 것 */
const termsToRead = (glossary: string[]) =>
  entriesOf(glossary)
    .filter(({ term, readings }) => needsReading(term) && !readings.length)
    .map(({ term }) => term)

const compact = (text: string) => text.replace(/\s+/g, '').toLowerCase()

/** GBNF 문자열 리터럴. 용어에 따옴표·역슬래시가 있어도 문법이 깨지지 않게 한다 */
const gbnfLiteral = (text: string) => `"${text.replace(/[\\"]/g, (char) => `\\${char}`)}"`

/**
 * @description 한글 발음을 따로 구해야 하는 용어(라틴 문자 등이 섞인 것)만 골라 읽기 프롬프트를 만듭니다.
 * @param glossary - 사용자가 입력한 회의 용어 (한 줄에 "용어" 또는 "용어 = 읽기1, 읽기2")
 * @returns 프롬프트. 읽기를 구할 용어가 없으면 `null`
 * @example
 * const prompt = buildReadingPrompt({ glossary: ['tarball', '배포'] }) // tarball만 묻는다
 */
export const buildReadingPrompt = ({ glossary }: { glossary: string[] }) => {
  const terms = termsToRead(glossary)
  if (!terms.length) return null

  return ['다음 용어의 한글 읽기를 적으세요.', '', ...terms.map((term) => `- ${term}`)].join('\n')
}

/**
 * @description 읽기 출력의 형식을 강제하는 llama.cpp GBNF 문법을 만듭니다. 용어는 사전에 있는 표기만, 읽기는 한글만 허용합니다.
 * @param glossary - 사용자가 입력한 회의 용어
 * @returns `--grammar-file`로 넘길 문법 텍스트
 * @example
 * const grammar = buildReadingGrammar({ glossary })
 */
export const buildReadingGrammar = ({ glossary }: { glossary: string[] }) => {
  const terms = termsToRead(glossary)

  return [
    'root ::= line+',
    'line ::= term " => " reading (", " reading){0,2} "\\n"',
    'reading ::= [가-힣] [가-힣 ]{0,15}',
    `term ::= ${terms.map(gbnfLiteral).join(' | ')}`
  ].join('\n')
}

interface ParseReadingsParams {
  output: string
  glossary: string[]
}

/**
 * @description 용어마다 비교할 한글 발음 목록을 만듭니다. 사용자가 "용어 = 읽기"로 적은 읽기가 우선이고,
 * 한글 용어는 그 자체가 발음이며, 나머지는 모델이 적은 읽기를 씁니다.
 * @param output - 읽기 프롬프트의 모델 답변. 한글 용어만 있으면 빈 문자열
 * @param glossary - 사용자가 입력한 회의 용어
 * @returns 용어 → 한글 발음 배열. 읽기를 얻지 못한 용어는 빈 배열이라 후보를 만들지 않는다
 * @example
 * const readings = parseReadings({ output: 'tarball => 타볼, 타르볼', glossary })
 */
export const parseReadings = ({ output, glossary }: ParseReadingsParams) => {
  const read = output
    .split('\n')
    .map((line) => READING_LINE.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ term: match[1], readings: match[2].split(',').map((r) => r.trim()) }))

  return new Map(
    entriesOf(glossary).map(({ term, readings }) => {
      if (readings.length) return [term, readings]
      if (!needsReading(term)) return [term, [term]]
      const modelReadings = read
        .filter((entry) => entry.term === term)
        .flatMap((entry) => entry.readings)
      return [term, [...new Set(modelReadings.filter(Boolean))]]
    })
  )
}

const wordCountOf = (text: string) => text.split(/\s+/).filter(Boolean).length

/** 어절 창 하나와, 끝의 조사를 뗀 형태. 두 어절 창은 둘째 어절에서만 뗀다 */
const trimmedVariants = (window: string) =>
  [
    window,
    ...PARTICLES.filter((particle) => window.endsWith(particle)).map((particle) =>
      window.slice(0, -particle.length)
    )
  ].filter(
    (variant, index, all) =>
      variant.length >= MIN_FROM_CHARS &&
      !variant.endsWith(' ') &&
      wordCountOf(variant) === wordCountOf(window) &&
      all.indexOf(variant) === index
  )

/**
 * 이미 맞게 적힌 어절 창인지. 어떤 용어든 그 표기·발음과 같거나, 그것을 통째로 품었거나(조사가 붙은
 * "브레이킹 체인지가"), 띄어 쓴 발음의 한 어절과 같으면(줄임말 "브레이킹") 화자가 그렇게 말한 것이다.
 * 다른 용어와 같은 것도 막는다 — "오토파일럿"이 "코파일럿" 후보가 되면 안 된다.
 * 발음의 앞부분을 품는 것만으로는 판단하지 않는다 — "모노래퍼"의 "모노"가 "모노레포"에 들어 있다.
 */
const isAlreadyCorrect = ({ variants, forms }: { variants: string[]; forms: string[] }) => {
  const wholeForms = forms.map(compact).filter((form) => form.length >= MIN_FROM_CHARS)
  const wordForms = forms
    .filter((form) => form.includes(' '))
    .flatMap((form) => form.split(/\s+/))
    .map(compact)

  return variants
    .map(compact)
    .some(
      (variant) => wholeForms.some((form) => variant.includes(form)) || wordForms.includes(variant)
    )
}

/**
 * 띄어 쓴 발음("피어 디펜던시")은 어절끼리 짝지어 가장 낮은 유사도를 쓴다. 통째로 재면
 * "브레이킹이 되는"이 앞 어절만으로 "브레이킹 체인지"에 가까워진다.
 */
const similarityOf = ({ from, reading }: { from: string; reading: string }) => {
  const fromWords = from.split(/\s+/)
  const readingWords = reading.split(/\s+/)
  if (fromWords.length !== readingWords.length) return phoneticSimilarity({ a: from, b: reading })

  return Math.min(
    ...fromWords.map((word, index) => phoneticSimilarity({ a: word, b: readingWords[index] }))
  )
}

interface FindRefineCandidatesParams {
  sources: RefineSource[]
  readings: Map<string, string[]>
}

/**
 * @description 발화의 어절을 용어 발음과 비교해 치환 후보를 만듭니다. 판정 전 단계라 넓게 잡습니다.
 * 띄어 쓴 발음("피어 디펜던시")은 두 어절 창, 붙여 쓴 발음은 한 어절 창과만 비교하고, 창마다 가장 가까운 용어 하나만 남깁니다.
 * @param sources - 교정 대상 발화
 * @param readings - `parseReadings`로 얻은 용어 → 한글 발음
 * @returns 발화·부분별로 중복을 없앤 후보 배열 (발화 순서)
 * @example
 * const candidates = findRefineCandidates({ sources, readings })
 */
export const findRefineCandidates = ({ sources, readings }: FindRefineCandidatesParams) => {
  const forms = [...readings.entries()].flatMap(([term, termReadings]) => [term, ...termReadings])

  return sources.flatMap((source) => {
    const words = source.text.split(/\s+/).filter(Boolean)
    const windows = words.flatMap((_, start) => [
      { text: words[start], isSpaced: false },
      ...(start + 1 < words.length
        ? [{ text: `${words[start]} ${words[start + 1]}`, isSpaced: true }]
        : [])
    ])

    const best = windows.flatMap(({ text, isSpaced }) => {
      const variants = trimmedVariants(text)
      if (isAlreadyCorrect({ variants, forms })) return []

      const scored = variants.flatMap((from) =>
        [...readings.entries()].flatMap(([term, termReadings]) =>
          termReadings
            .filter((reading) => reading.includes(' ') === isSpaced)
            .map((reading) => ({ from, to: term, similarity: similarityOf({ from, reading }) }))
        )
      )
      const top = scored.toSorted((a, b) => b.similarity - a.similarity)[0]
      if (!top || top.similarity < MIN_PHONETIC_SIMILARITY) return []

      // 조사까지 품은 창이 더 비슷하게 나와도 조사를 뗀 형태로 치환한다 ("오토파이오처럼" → "오토파이오")
      const shortest = scored
        .filter(({ to, similarity }) => to === top.to && similarity >= MIN_PHONETIC_SIMILARITY)
        .toSorted((a, b) => a.from.length - b.from.length)[0]
      return [shortest]
    })

    return best
      .filter((pair, index) => best.findIndex((other) => other.from === pair.from) === index)
      .map((pair) => ({ utteranceId: source.id, ...pair }))
  })
}

/**
 * @description 후보를 판정 배치로 나눕니다. 번호를 배치 안에서 1부터 매기므로 한 배치가 `VERIFY_BATCH_SIZE`를 넘지 않게 합니다.
 * @param candidates - `findRefineCandidates`가 만든 후보
 * @returns 후보 배치 배열
 * @example
 * const batches = splitVerifyBatches({ candidates })
 */
export const splitVerifyBatches = ({ candidates }: { candidates: RefinePair[] }) =>
  Array.from({ length: Math.ceil(candidates.length / VERIFY_BATCH_SIZE) }, (_, index) =>
    candidates.slice(index * VERIFY_BATCH_SIZE, (index + 1) * VERIFY_BATCH_SIZE)
  )

const contextOf = ({ text, from }: { text: string; from: string }) => {
  const at = text.indexOf(from)
  const start = Math.max(0, at - CONTEXT_CHARS)
  const end = Math.min(text.length, at + from.length + CONTEXT_CHARS)
  const marked = `${text.slice(start, at)}«${from}»${text.slice(at + from.length, end)}`

  return `${start > 0 ? '…' : ''}${marked}${end < text.length ? '…' : ''}`
}

interface BuildVerifyPromptParams {
  batch: RefinePair[]
  sources: RefineSource[]
}

/**
 * @description 후보 판정 프롬프트를 만듭니다. 후보마다 용어, 의심 부분, 앞뒤 문맥을 한 줄로 보여 줍니다.
 * @param batch - `splitVerifyBatches`로 얻은 배치 하나
 * @param sources - 후보가 가리키는 발화 원문
 * @returns llama-cli에 파일로 넘길 프롬프트
 * @example
 * const prompt = buildVerifyPrompt({ batch, sources })
 */
export const buildVerifyPrompt = ({ batch, sources }: BuildVerifyPromptParams) => {
  const textOf = new Map(sources.map((source) => [source.id, source.text]))

  return [
    '다음 후보를 판정하세요.',
    '',
    ...batch.map(
      ({ utteranceId, from, to }, index) =>
        `[${index + 1}] ${contextOf({ text: textOf.get(utteranceId) ?? '', from })} → «${from}»를 "${to}"로?`
    )
  ].join('\n')
}

/**
 * @description 판정 출력의 형식을 강제하는 llama.cpp GBNF 문법을 만듭니다. 번호와 순서를 문법이 고정하므로 모델은 O/X만 고릅니다.
 * @param count - 배치의 후보 수
 * @returns `--grammar-file`로 넘길 문법 텍스트
 * @example
 * const grammar = buildVerifyGrammar({ count: batch.length })
 */
export const buildVerifyGrammar = ({ count }: { count: number }) =>
  [
    `root ::= ${Array.from({ length: count }, (_, index) => `"[${index + 1}] " verdict "\\n"`).join(' ')}`,
    `verdict ::= ${gbnfLiteral(APPROVE)} | ${gbnfLiteral(REJECT)}`
  ].join('\n')

interface ParseVerifyOutputParams {
  output: string
  batch: RefinePair[]
}

/**
 * @description 판정 출력에서 O로 답한 후보만 고릅니다. 답이 없거나 형식이 깨진 후보는 X로 봅니다.
 * @param output - 판정 프롬프트의 모델 답변
 * @param batch - 프롬프트를 만든 배치
 * @returns 통과한 후보 배열
 * @example
 * const approved = parseVerifyOutput({ output: '[1] O\n[2] X', batch })
 */
export const parseVerifyOutput = ({ output, batch }: ParseVerifyOutputParams) => {
  const approved = new Set(
    output
      .split('\n')
      .map((line) => VERDICT_LINE.exec(line))
      .filter((match): match is RegExpExecArray => match !== null && match[2] === APPROVE)
      .map((match) => Number(match[1]) - 1)
  )

  return batch.filter((_, index) => approved.has(index))
}

interface ApplyRefinePairsParams {
  sources: RefineSource[]
  pairs: RefinePair[]
}

/**
 * @description 판정을 통과한 쌍을 발화에 적용해 발화별 수정 제안을 만듭니다.
 * 긴 부분부터 치환해 겹치는 쌍이 서로를 깨지 않게 합니다.
 * @param sources - 교정 대상 발화
 * @param pairs - 판정을 통과한 쌍
 * @returns 실제로 바뀐 발화의 제안 배열 (발화 순서)
 * @example
 * const suggestions = applyRefinePairs({ sources, pairs: approved })
 */
export const applyRefinePairs = ({ sources, pairs }: ApplyRefinePairsParams) =>
  sources
    .map((source): RefineSuggestion => {
      const own = pairs
        .filter((pair) => pair.utteranceId === source.id)
        .toSorted((a, b) => b.from.length - a.from.length)
      const after = own.reduce((text, { from, to }) => text.replaceAll(from, to), source.text)
      return {
        id: source.id,
        before: source.text,
        after,
        pairs: own.map(({ from, to }) => ({ from, to }))
      }
    })
    .filter(({ before, after }) => before !== after)
