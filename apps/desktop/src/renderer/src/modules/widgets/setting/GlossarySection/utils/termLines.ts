import { acronymReading } from '@shared/glossary'

import type { TermEntry } from '../types/termRow'

/** 저장 형식 `용어 = 읽기1, 읽기2`의 구분자. `src/shared/refine.ts`가 읽는 형식과 같다 */
const READING_SEPARATOR = '='
const READINGS_JOINER = ', '

/** 한국어 입력기로 치면 전각 쉼표·모점이 섞여 들어와 반각 쉼표와 같이 받는다 */
const READINGS_SPLITTER = /[,，、]/

const FORBIDDEN_TERM_CHARS = /[=\r\n]/g

export const EMPTY_TERM_ENTRY: TermEntry = { term: '', readings: '' }

const splitReadings = (readings: string) =>
  readings
    .split(READINGS_SPLITTER)
    .map((reading) => reading.trim())
    .filter(Boolean)

/**
 * @description 용어 칸 입력에서 저장 형식을 깨는 문자(`=`, 줄바꿈)를 뺍니다.
 * @param text - 용어 칸에 입력한 값
 * @returns 정리한 값
 * @example
 * sanitizeTerm('GitHub=') // 'GitHub'
 */
export const sanitizeTerm = (text: string) => text.replace(FORBIDDEN_TERM_CHARS, '')

/**
 * @description 저장된 용어 한 줄을 행 입력값으로 나눕니다. 첫 `=` 앞이 용어, 뒤가 읽기입니다.
 * @param line - `용어` 또는 `용어 = 읽기1, 읽기2`
 * @returns 행 입력값
 * @example
 * parseTermLine('tarball = 타볼，타르볼') // { term: 'tarball', readings: '타볼, 타르볼' }
 */
export const parseTermLine = (line: string) => {
  const separatorIndex = line.indexOf(READING_SEPARATOR)
  if (separatorIndex < 0) return { term: line.trim(), readings: '' }

  return {
    term: line.slice(0, separatorIndex).trim(),
    readings: splitReadings(line.slice(separatorIndex + 1)).join(READINGS_JOINER)
  }
}

/**
 * @description 여러 줄 텍스트를 행 입력값 목록으로 나눕니다. 용어가 빈 줄은 뺍니다.
 * @param text - 붙여 넣은 텍스트
 * @returns 행 입력값 목록
 * @example
 * parseTermLines('모노레포\nGitHub = 깃허브\n') // 두 행
 */
export const parseTermLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map(parseTermLine)
    .filter(({ term }) => term)

/**
 * @description 붙여 넣은 텍스트를 여러 행으로 나눠야 하는지 판단합니다. 줄바꿈이나 `=`가 있으면 목록으로 봅니다.
 * @param text - 붙여 넣은 텍스트
 * @returns 행으로 나눠야 하면 true
 * @example
 * isTermListText('GitHub = 깃허브') // true
 */
export const isTermListText = (text: string) =>
  /[\r\n]/.test(text.trim()) || text.includes(READING_SEPARATOR)

/**
 * @description 대문자 약어의 읽기가 비어 있을 때 채울 읽기를 구합니다.
 * @param entry - 행 입력값
 * @returns 코드가 만든 약어 읽기. 읽기를 적었거나 약어가 아니면 undefined
 * @example
 * autoReadingOf({ term: 'CI/CD', readings: '' }) // '씨아이 씨디'
 */
export const autoReadingOf = ({ term, readings }: TermEntry) =>
  splitReadings(readings).length ? undefined : acronymReading(term.trim())

/**
 * @description 행 입력값을 저장 형식 한 줄로 만듭니다. 비어 있는 약어 읽기는 코드 읽기로 채웁니다.
 * @param entry - 행 입력값
 * @returns 저장할 줄. 용어가 비어 있으면 빈 문자열
 * @example
 * formatTermLine({ term: 'JWT', readings: '' }) // 'JWT = 제이더블유티'
 */
export const formatTermLine = (entry: TermEntry) => {
  const term = entry.term.trim()
  if (!term) return ''

  const autoReading = autoReadingOf(entry)
  const readings = autoReading ? [autoReading] : splitReadings(entry.readings)

  return readings.length ? `${term} ${READING_SEPARATOR} ${readings.join(READINGS_JOINER)}` : term
}

/**
 * @description 행 목록을 저장할 줄 목록으로 만듭니다. 용어가 빈 행은 뺍니다.
 * @param entries - 행 입력값 목록
 * @returns `GlossarySettings.terms`로 보낼 줄 목록
 * @example
 * toTermLines(rows)
 */
export const toTermLines = (entries: TermEntry[]) => entries.map(formatTermLine).filter(Boolean)
