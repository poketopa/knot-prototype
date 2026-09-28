import { describe, expect, it } from 'vitest'

import {
  autoReadingOf,
  formatTermLine,
  isTermListText,
  parseTermLine,
  parseTermLines,
  sanitizeTerm,
  toTermLines
} from './termLines'

describe('parseTermLine', () => {
  it('읽기가 없는 줄은 용어만 채운다', () => {
    expect(parseTermLine('  모노레포 ')).toEqual({ term: '모노레포', readings: '' })
  })

  it('첫 = 앞을 용어로, 뒤를 읽기로 나누고 쉼표 종류를 맞춘다', () => {
    expect(parseTermLine('tarball = 타볼，타르볼、 탈볼')).toEqual({
      term: 'tarball',
      readings: '타볼, 타르볼, 탈볼'
    })
  })
})

describe('parseTermLines', () => {
  it('줄마다 행으로 나누고 빈 줄은 뺀다', () => {
    expect(parseTermLines('모노레포\r\n\nGitHub = 깃허브\n  \n')).toEqual([
      { term: '모노레포', readings: '' },
      { term: 'GitHub', readings: '깃허브' }
    ])
  })
})

describe('isTermListText', () => {
  it('줄바꿈이나 =가 있으면 목록으로 본다', () => {
    expect(isTermListText('모노레포\nGitHub')).toBe(true)
    expect(isTermListText('GitHub = 깃허브')).toBe(true)
  })

  it('한 단어나 끝의 줄바꿈만 있는 텍스트는 목록이 아니다', () => {
    expect(isTermListText('GitHub')).toBe(false)
    expect(isTermListText('GitHub\n')).toBe(false)
  })
})

describe('sanitizeTerm', () => {
  it('= 와 줄바꿈을 뺀다', () => {
    expect(sanitizeTerm('Git=Hub\n')).toBe('GitHub')
  })
})

describe('autoReadingOf', () => {
  it('읽기가 빈 대문자 약어는 코드 읽기를 준다', () => {
    expect(autoReadingOf({ term: 'CI/CD', readings: '' })).toBe('씨아이 씨디')
  })

  it('읽기를 적었거나 약어가 아니면 주지 않는다', () => {
    expect(autoReadingOf({ term: 'JWT', readings: '조트' })).toBeUndefined()
    expect(autoReadingOf({ term: 'GitHub', readings: '' })).toBeUndefined()
  })
})

describe('formatTermLine', () => {
  it('읽기가 없으면 용어만 적는다', () => {
    expect(formatTermLine({ term: ' GitHub ', readings: ' , ' })).toBe('GitHub')
  })

  it('읽기를 쉼표로 이어 = 뒤에 적는다', () => {
    expect(formatTermLine({ term: 'tarball', readings: '타볼，타르볼' })).toBe(
      'tarball = 타볼, 타르볼'
    )
  })

  it('비어 있는 약어 읽기를 채운다', () => {
    expect(formatTermLine({ term: 'JWT', readings: '' })).toBe('JWT = 제이더블유티')
  })
})

describe('toTermLines', () => {
  it('용어가 빈 행은 저장하지 않는다', () => {
    expect(
      toTermLines([
        { term: '모노레포', readings: '' },
        { term: ' ', readings: '깃허브' }
      ])
    ).toEqual(['모노레포'])
  })
})
