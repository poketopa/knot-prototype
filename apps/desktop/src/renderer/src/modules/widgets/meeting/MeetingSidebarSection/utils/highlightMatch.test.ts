import { describe, expect, it } from 'vitest'
import { highlightMatch } from './highlightMatch'

const MAX = 40

describe('highlightMatch', () => {
  it('일치 부분과 나머지를 나눈다', () => {
    expect(
      highlightMatch({ text: '배포 일정을 정리합니다', query: '일정', maxChars: MAX })
    ).toEqual([
      { text: '배포 ', isMatch: false },
      { text: '일정', isMatch: true },
      { text: '을 정리합니다', isMatch: false }
    ])
  })

  it('영문은 대소문자를 구분하지 않고 원래 표기를 살린다', () => {
    expect(highlightMatch({ text: 'GitHub 저장소', query: 'github', maxChars: MAX })).toEqual([
      { text: 'GitHub', isMatch: true },
      { text: ' 저장소', isMatch: false }
    ])
  })

  it('여러 번 나오면 모두 표시한다', () => {
    const segments = highlightMatch({ text: '회의 끝나고 회의록', query: '회의', maxChars: MAX })

    expect(segments.filter(({ isMatch }) => isMatch)).toHaveLength(2)
  })

  it('일치가 없으면 통째로 한 조각이다', () => {
    expect(highlightMatch({ text: '주간 회의', query: '배포', maxChars: MAX })).toEqual([
      { text: '주간 회의', isMatch: false }
    ])
  })

  it('%·_ 같은 특수 문자도 글자 그대로 찾는다', () => {
    expect(highlightMatch({ text: '전환율 50% 달성', query: '50%', maxChars: MAX })).toEqual([
      { text: '전환율 ', isMatch: false },
      { text: '50%', isMatch: true },
      { text: ' 달성', isMatch: false }
    ])
  })

  it('긴 발화는 일치 부분 주변만 남기고 말줄임표를 붙인다', () => {
    const text = `${'가'.repeat(100)}배포${'나'.repeat(100)}`
    const segments = highlightMatch({ text, query: '배포', maxChars: 20 })
    const joined = segments.map((segment) => segment.text).join('')

    expect(joined.startsWith('…')).toBe(true)
    expect(joined.endsWith('…')).toBe(true)
    expect(segments.some(({ text: part, isMatch }) => isMatch && part === '배포')).toBe(true)
  })
})
