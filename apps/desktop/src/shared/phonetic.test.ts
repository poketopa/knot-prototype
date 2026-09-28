import { describe, expect, it } from 'vitest'

import { needsReading, phoneticSimilarity, toJamo } from './phonetic'

describe('toJamo', () => {
  it('음절을 초성·중성·종성으로 풀고 소리 없는 초성 ㅇ은 버린다', () => {
    expect(toJamo('카볼')).toEqual(['ㅋ', 'ㅏ', 'ㅂ', 'ㅗ', 'ㄹ'])
    expect(toJamo('을')).toEqual(['ㅡ', 'ㄹ'])
  })

  it('공백·문장부호는 버리고 라틴 문자는 소문자로 둔다', () => {
    expect(toJamo('A 가.')).toEqual(['a', 'ㄱ', 'ㅏ'])
  })
})

describe('phoneticSimilarity', () => {
  it('인식 오류로 뭉개진 표기는 가깝게 잰다', () => {
    expect(phoneticSimilarity({ a: '카볼', b: '타볼' })).toBeCloseTo(0.8)
    expect(phoneticSimilarity({ a: '대포', b: '배포' })).toBeCloseTo(0.75)
    expect(phoneticSimilarity({ a: '모노래퍼', b: '모노레포' })).toBeGreaterThanOrEqual(0.7)
  })

  it('소리가 다른 말은 멀게 잰다', () => {
    expect(phoneticSimilarity({ a: '등분분서', b: '브레이킹 체인지' })).toBeLessThan(0.3)
    expect(phoneticSimilarity({ a: '대포', b: '타르볼' })).toBeLessThan(0.3)
  })

  it('같은 발음은 1, 빈 문자열끼리는 0이다', () => {
    expect(phoneticSimilarity({ a: '디프', b: '디프' })).toBe(1)
    expect(phoneticSimilarity({ a: '', b: '' })).toBe(0)
  })
})

describe('needsReading', () => {
  it('라틴 문자가 섞인 용어만 한글 읽기가 필요하다', () => {
    expect(needsReading('tarball')).toBe(true)
    expect(needsReading('Yarn Berry')).toBe(true)
    expect(needsReading('모노레포')).toBe(false)
    expect(needsReading('배포 (최종)')).toBe(false)
  })
})
