/**
 * 전역 용어 사전의 순수 로직 (Phase 5-4).
 *
 * 설정의 팀 소개로 LLM이 초안을 만들고 사용자가 고쳐 저장한다. 모델 초안에는 일반어와 틀린 읽기가 섞이므로
 * 자동으로 저장하지 않는다 (docs/phase5-refine-results.md "팀 소개로 용어 초안 만들기").
 * 줄 형식은 `용어` 또는 `영어 표기 = 읽기1, 읽기2`로 `src/shared/refine.ts`가 읽는 형식과 같다.
 * 읽기는 검수한 사전(`@meeting-stt/core/termReadings`) → 약어 규칙 → `.js` 규칙 순으로 모델 읽기를 덮어쓴다.
 * spawn·파일 IO는 호출하는 쪽이 담당한다.
 */

import { termReadingOf } from '@meeting-stt/core/termReadings'

import type { GlossarySettings } from './types'

export const GLOSSARY_TEAM_MAX_CHARS = 500
export const GLOSSARY_MAX_TERMS = 200
export const GLOSSARY_TERM_MAX_CHARS = 80

/** 시스템 프롬프트 + 팀 소개 + 초안 25줄이면 2천 토큰을 넘지 않는다 */
export const GLOSSARY_CTX_TOKENS = 4096

/** 초안 한 줄은 15토큰 안팎이다. 문법이 줄 수를 25개로 막는다 */
export const GLOSSARY_MAX_PREDICT_TOKENS = 500

/** 읽기 구분자. refine.ts와 같다 */
const READING_SEPARATOR = '='

/**
 * 모델은 약어를 자주 틀리게 읽었다(JWT=제이에이티비, CI/CD=시이아이케이디). 대문자 약어는 알파벳 이름을
 * 이어 붙이면 틀릴 일이 없어 코드가 읽는다.
 */
const LETTER_NAMES: Record<string, string> = {
  A: '에이',
  B: '비',
  C: '씨',
  D: '디',
  E: '이',
  F: '에프',
  G: '지',
  H: '에이치',
  I: '아이',
  J: '제이',
  K: '케이',
  L: '엘',
  M: '엠',
  N: '엔',
  O: '오',
  P: '피',
  Q: '큐',
  R: '알',
  S: '에스',
  T: '티',
  U: '유',
  V: '브이',
  W: '더블유',
  X: '엑스',
  Y: '와이',
  Z: '지'
}

/** 약어 안의 숫자는 영어로 읽는다 (S3 → 에스쓰리) */
const DIGIT_NAMES: Record<string, string> = {
  '0': '제로',
  '1': '원',
  '2': '투',
  '3': '쓰리',
  '4': '포',
  '5': '파이브',
  '6': '식스',
  '7': '세븐',
  '8': '에잇',
  '9': '나인'
}

const ACRONYM_PART = /^(?=.*[A-Z])[A-Z0-9]{2,6}$/

/** 모델은 `Next.js`의 점을 "포인트·닷"으로 읽는다 */
const JS_SUFFIX = /\.js$/i
const JS_READING = '제이에스'

/** 팀 소개에서 영어 이름을 찾는다. 문장 끝 마침표 같은 꼬리 기호는 이름이 아니다 */
const TEAM_TERM = /[A-Za-z0-9][A-Za-z0-9.+#/_-]*/g
const TEAM_TERM_TRAILING = /[./_-]+$/
const HAS_LETTER = /[A-Za-z]/
const TEAM_TERM_MIN_CHARS = 2

const DRAFT_LINE = /^(?:[가-힣][가-힣 ]*|[A-Za-z0-9][A-Za-z0-9 .+#/_-]*\s=\s[가-힣][가-힣 ]*)$/

/**
 * 일반어는 발음이 비슷한 일상어와 끝없이 겹쳐 교정 오탐을 만든다. 일반어 목록(React·CSS·빌드·브랜치)을 쓰면
 * 71분 회의에서 "같은→Git", "케이스→CSS" 같은 후보가 84개 나왔다 (docs/phase5-refine-results.md).
 */
export const GLOSSARY_SYSTEM_PROMPT = [
  '당신은 한국어 회의 음성 인식을 돕습니다. 음성 인식은 영어 기술 용어, 제품·도구·서비스 이름, 약어, 외래어를 자주 틀리게 받아 적습니다.',
  '팀 소개를 읽고 그 팀 회의에서 실제로 소리 내어 말할 법한 그런 용어만 적으세요.',
  '- 팀 소개에 영어로 적힌 이름은 빠짐없이 먼저 적습니다.',
  '- 누구나 아는 일반 단어(회의, 개발, 코드, 일정, 문제, 버전 관리 같은 말)는 적지 않습니다.',
  '- 넓은 분야 이름보다 구체적인 도구·개념 이름을 적습니다. 영어는 세 단어를 넘지 않게 적습니다.',
  '- 영어 용어는 "영어 표기 = 한국 사람이 실제로 부르는 한글 발음" 형식으로 적습니다.',
  '- 예시:',
  'Kubernetes = 쿠버네티스',
  'GitHub = 깃허브',
  'React = 리액트',
  'npm = 엔피엠',
  '- 한국 회의에서 영어 이름 그대로 소리 내어 부르는 용어만 적습니다. 한국어로 번역해 부르는 말(광고 성과, 전환율 같은 말)은 적지 않습니다.',
  '- 읽기는 뜻풀이가 아니라 영어 소리를 한글로 적은 것입니다.'
].join('\n')

/**
 * 초안 출력 형식을 못박는 llama.cpp GBNF 문법. 한글 용어 줄 또는 `영어 = 한글 읽기` 줄만 3~25개 허용한다.
 * 문법 없이 돌리면 설명·번호를 섞어 적는다. 줄 수가 많으면 짧은 팀 소개에서 흔한 이름으로 빈자리를 채운다.
 */
export const GLOSSARY_DRAFT_GRAMMAR = [
  'root ::= line{3,25}',
  'line ::= en " = " reading "\\n"',
  'en ::= [A-Za-z0-9] [A-Za-z0-9 .+#/_-]{0,29}',
  'reading ::= [가-힣] [가-힣 ]{0,19}'
].join('\n')

/**
 * @description 팀 소개로 용어 초안을 요청하는 프롬프트를 만듭니다.
 * @param teamDescription - 설정에 적은 팀 소개
 * @returns llama-cli `-f`로 넘길 프롬프트
 * @example
 * const prompt = buildGlossaryDraftPrompt({ teamDescription: '프론트엔드 개발팀' })
 */
export const buildGlossaryDraftPrompt = ({ teamDescription }: { teamDescription: string }) =>
  ['팀 소개: ' + teamDescription, '', '용어를 적으세요.'].join('\n')

/**
 * @description 대문자 약어의 한글 읽기를 알파벳 이름으로 만듭니다. 숫자는 영어로 읽고,
 * `/`로 이은 약어는 조각마다 읽어 띄어 씁니다.
 * @param term - 용어 표기
 * @returns 한글 읽기. 약어가 아니면 undefined
 * @example
 * acronymReading('CI/CD') // '씨아이 씨디'
 * acronymReading('S3') // '에스쓰리'
 */
export const acronymReading = (term: string) => {
  const parts = term.split('/')
  if (!parts.every((part) => ACRONYM_PART.test(part))) return undefined

  return parts
    .map((part) => [...part].map((char) => LETTER_NAMES[char] ?? DIGIT_NAMES[char]).join(''))
    .join(' ')
}

const termKeyOf = (line: string) => line.split(READING_SEPARATOR)[0].trim().toLowerCase()

/**
 * @description 용어 줄을 정리합니다. 앞뒤 공백을 자르고 빈 줄과 중복 용어(`=` 앞부분, 대소문자 무시)를 뺍니다.
 * 중복이면 먼저 나온 줄을 남깁니다.
 * @param lines - 용어 줄 목록
 * @returns 정리한 목록
 * @example
 * normalizeGlossaryTerms(['GitHub = 깃허브', 'github']) // ['GitHub = 깃허브']
 */
export const normalizeGlossaryTerms = (lines: string[]) =>
  lines
    .map((line) => line.trim())
    .filter((line) => termKeyOf(line))
    .filter(
      (line, index, all) => all.findIndex((other) => termKeyOf(other) === termKeyOf(line)) === index
    )

const termLine = ({ term, reading }: { term: string; reading: string }) =>
  `${term} ${READING_SEPARATOR} ${reading}`

/**
 * @description 코드가 정할 수 있는 읽기 줄을 만듭니다. 검수한 사전이 먼저이고(표기도 사전 표기로 맞춤), 없으면 약어 규칙입니다.
 * 사전은 사람이 검수한 값이라 `SQL = 시퀄`처럼 약어 모양이어도 사전이 이깁니다.
 * @param term - 용어 표기
 * @returns `용어 = 읽기` 줄. 사전에도 없고 약어도 아니면 undefined
 * @example
 * codeReadingLineOf('github') // 'GitHub = 깃허브'
 * codeReadingLineOf('JWT') // 'JWT = 제이더블유티'
 * codeReadingLineOf('whisper.cpp') // undefined
 */
export const codeReadingLineOf = (term: string) => {
  const entry = termReadingOf(term)
  if (entry) return termLine(entry)

  const reading = acronymReading(term)
  return reading ? termLine({ term, reading }) : undefined
}

const withCodeReading = (line: string) =>
  codeReadingLineOf(line.split(READING_SEPARATOR)[0].trim()) ?? line

const withJsReading = (line: string) => {
  const [termPart, readingPart] = line.split(READING_SEPARATOR)
  const term = termPart.trim()
  const reading = readingPart?.trim()
  if (!reading || !JS_SUFFIX.test(term) || reading.endsWith(JS_READING)) return line

  const words = reading.split(' ')
  const base = words.length > 1 ? words.slice(0, -1) : words

  return termLine({ term, reading: [...base, JS_READING].join(' ') })
}

/**
 * @description llama-cli 초안 답변을 용어 줄 목록으로 바꿉니다. 형식에 맞지 않는 줄은 버리고,
 * 검수한 사전에 있는 용어와 약어는 모델 읽기 대신 코드 읽기를 쓰며 `.js` 이름은 읽기 끝을 `제이에스`로 고칩니다.
 * @param answer - 모델 답변 본문
 * @returns 용어 줄 목록
 * @example
 * parseGlossaryDraft('Jira = 재자\nJWT = 제이에이티비\n') // ['Jira = 지라', 'JWT = 제이더블유티']
 */
export const parseGlossaryDraft = (answer: string) =>
  normalizeGlossaryTerms(
    answer
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => DRAFT_LINE.test(line))
      .map(withCodeReading)
      .map(withJsReading)
  )

/**
 * @description 팀 소개에 영어로 적힌 이름을 찾습니다. 글자가 없는 숫자와 한 글자는 뺍니다.
 * @param teamDescription - 설정에 적은 팀 소개
 * @returns 적힌 순서대로 중복 없는 이름 목록
 * @example
 * teamTermsOf('Electron, React로 회의록 앱을 만듭니다.') // ['Electron', 'React']
 */
export const teamTermsOf = (teamDescription: string) =>
  normalizeGlossaryTerms(
    (teamDescription.match(TEAM_TERM) ?? [])
      .map((token) => token.replace(TEAM_TERM_TRAILING, ''))
      .filter((token) => token.length >= TEAM_TERM_MIN_CHARS && HAS_LETTER.test(token))
  )

interface PrependTeamTermsParams {
  terms: string[]
  teamDescription: string
}

/**
 * @description 팀 소개에 적힌 영어 이름을 초안 맨 앞으로 모읍니다. 모델이 적은 줄이 있으면 그 줄을,
 * 없으면 사전·약어는 코드 읽기로, 그 외는 읽기 없이 이름만 넣어 사용자가 채우게 합니다.
 * @param terms - `parseGlossaryDraft`로 정리한 초안
 * @param teamDescription - 설정에 적은 팀 소개
 * @returns 팀 소개 이름이 앞에 온 초안
 * @example
 * prependTeamTerms({ terms: ['Vite = 비트'], teamDescription: 'Electron 앱' }) // ['Electron = 일렉트론', 'Vite = 비트']
 */
export const prependTeamTerms = ({ terms, teamDescription }: PrependTeamTermsParams) => {
  const teamLines = teamTermsOf(teamDescription).map((term) => {
    const drafted = terms.find((line) => termKeyOf(line) === term.toLowerCase())

    return drafted ?? codeReadingLineOf(term) ?? term
  })

  return normalizeGlossaryTerms([...teamLines, ...terms])
}

interface MergeGlossaryTermsParams {
  current: string[]
  additions: string[]
}

/**
 * @description 편집 중인 목록 뒤에 초안의 새 용어만 덧붙입니다. 이미 있는 용어는 사용자가 고친 쪽을 남깁니다.
 * @param current - 편집 중인 용어 목록
 * @param additions - 초안 용어 목록
 * @returns 합친 목록과 새로 붙은 용어 수
 * @example
 * const { terms, addedCount } = mergeGlossaryTerms({ current, additions: draft })
 */
export const mergeGlossaryTerms = ({ current, additions }: MergeGlossaryTermsParams) => {
  const base = normalizeGlossaryTerms(current)
  const terms = normalizeGlossaryTerms([...base, ...additions])

  return { terms, addedCount: terms.length - base.length }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const readDescription = (value: unknown) => {
  if (typeof value !== 'string') throw new Error('잘못된 요청입니다 (팀 소개 없음)')

  const text = value.trim()
  if (text.length > GLOSSARY_TEAM_MAX_CHARS) {
    throw new Error(`팀 소개는 ${GLOSSARY_TEAM_MAX_CHARS}자까지 적을 수 있습니다`)
  }

  return text
}

/**
 * @description renderer가 보낸 용어 사전 설정을 검증하고 정리합니다. 한도를 넘으면 한국어 메시지로 거절합니다.
 * @param payload - `glossary:update` 요청 payload
 * @returns 정리한 설정
 * @example
 * const settings = readGlossarySettings(payload)
 */
export const readGlossarySettings = (payload: unknown): GlossarySettings => {
  if (!isRecord(payload) || !Array.isArray(payload.terms)) {
    throw new Error('잘못된 요청입니다 (용어 목록 없음)')
  }

  const lines = payload.terms
  if (!lines.every((line): line is string => typeof line === 'string')) {
    throw new Error('잘못된 요청입니다 (용어 형식 오류)')
  }

  const terms = normalizeGlossaryTerms(lines)
  const tooLong = terms.find((term) => term.length > GLOSSARY_TERM_MAX_CHARS)
  if (tooLong) {
    throw new Error(`용어 한 줄은 ${GLOSSARY_TERM_MAX_CHARS}자까지 적을 수 있습니다: ${tooLong}`)
  }
  if (terms.length > GLOSSARY_MAX_TERMS) {
    throw new Error(`용어는 ${GLOSSARY_MAX_TERMS}개까지 저장할 수 있습니다`)
  }

  return { teamDescription: readDescription(payload.teamDescription), terms }
}

/**
 * @description 초안 요청의 팀 소개를 검증합니다. 비어 있으면 거절합니다.
 * @param payload - `glossary:draft` 요청 payload
 * @returns 앞뒤 공백을 자른 팀 소개
 * @example
 * const teamDescription = readTeamDescription(payload)
 */
export const readTeamDescription = (payload: unknown) => {
  const text = readDescription(isRecord(payload) ? payload.teamDescription : undefined)
  if (!text) throw new Error('팀 소개를 먼저 적어 주세요')

  return text
}
