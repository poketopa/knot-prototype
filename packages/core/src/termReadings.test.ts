import { describe, expect, it } from 'vitest'

import { TERM_READINGS, termReadingOf } from './termReadings'

// 용어 초안의 `영어 표기` 줄이 허용하는 문자 (apps/desktop/src/shared/glossary.ts DRAFT_LINE)
const TERM_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 .+#/_-]*$/
// 한글 단어(띄어쓰기 허용)를 `, `로 이은 읽기
const READING_PATTERN = /^[가-힣]+( [가-힣]+)*(, [가-힣]+( [가-힣]+)*)?$/

describe('TERM_READINGS', () => {
  const entries = Object.entries(TERM_READINGS)

  it('표기는 초안 줄 형식에 맞고 대소문자 무시로 겹치지 않는다', () => {
    const keys = entries.map(([term]) => term.toLowerCase())

    expect(entries.every(([term]) => TERM_PATTERN.test(term))).toBe(true)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('읽기는 한글뿐이고 변형은 쉼표로 2개까지다', () => {
    const wrong = entries.filter(([, reading]) => !READING_PATTERN.test(reading))

    expect(wrong).toEqual([])
  })

  it('모델이 자주 틀리던 읽기가 들어 있다', () => {
    expect(TERM_READINGS.Jira).toBe('지라')
    expect(TERM_READINGS.Git).toBe('깃')
    expect(TERM_READINGS.Redux).toBe('리덕스')
    expect(TERM_READINGS.Tailwind).toBe('테일윈드')
    expect(TERM_READINGS.ESLint).toBe('이에스린트')
  })
})

describe('termReadingOf', () => {
  it('대소문자를 무시하고 정식 표기와 읽기를 돌려준다', () => {
    expect(termReadingOf('github')).toEqual({ term: 'GitHub', reading: '깃허브' })
    expect(termReadingOf(' NEXT.JS ')).toEqual({ term: 'Next.js', reading: '넥스트 제이에스' })
  })

  it('사전에 없으면 undefined', () => {
    expect(termReadingOf('whisper.cpp')).toBeUndefined()
    expect(termReadingOf('')).toBeUndefined()
  })
})
