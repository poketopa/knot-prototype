import { describe, expect, it } from 'vitest'
import { toLikePattern } from './searchQuery'

describe('toLikePattern', () => {
  it('검색어 앞뒤에 와일드카드를 붙인다', () => {
    expect(toLikePattern('회의록')).toBe('%회의록%')
  })

  it('앞뒤 공백은 지우고 가운데 공백은 남긴다', () => {
    expect(toLikePattern('  배포 일정 ')).toBe('%배포 일정%')
  })

  it('비었거나 공백뿐이면 null이다', () => {
    expect(toLikePattern('')).toBeNull()
    expect(toLikePattern('   ')).toBeNull()
  })

  it('%와 _는 글자 그대로 찾도록 이스케이프한다', () => {
    expect(toLikePattern('50%')).toBe('%50\\%%')
    expect(toLikePattern('user_id')).toBe('%user\\_id%')
  })

  it('역슬래시도 이스케이프한다', () => {
    expect(toLikePattern('a\\b')).toBe('%a\\\\b%')
  })
})
