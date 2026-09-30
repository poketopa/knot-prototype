import { describe, expect, it } from 'vitest'

import { prototypeBroadDocumentDomain } from './prototype'

describe('prototypeBroadDocumentDomain', () => {
  it('AI가 정한 사용자별 도메인을 키워드 규칙으로 덮어쓰지 않는다', () => {
    expect(
      prototypeBroadDocumentDomain({
        domain: '회의 문서 템플릿 적용 방식',
        title: '결정 문서 구조',
        overview: '회의록과 원문을 문서로 보관하는 방식을 논의했다.'
      })
    ).toBe('회의 문서 템플릿 적용 방식')
    expect(
      prototypeBroadDocumentDomain({
        domain: '녹음 분석 품질과 AI 성능 개선',
        title: '화자 분리 모델 개선'
      })
    ).toBe('녹음 분석 품질과 AI 성능 개선')
    expect(
      prototypeBroadDocumentDomain({
        domain: '개발 단위 및 개발 순서 결정',
        title: '서버 배포와 업로드 QA'
      })
    ).toBe('개발 단위 및 개발 순서 결정')
  })

  it('여러 단어로 된 개인화 큰 도메인도 그대로 유지하고 공백만 정리한다', () => {
    expect(prototypeBroadDocumentDomain({ domain: '  철학과   독서  ', title: '삶의 고민' })).toBe(
      '철학과 독서'
    )
  })

  it('도메인이 없을 때만 제목을 fallback으로 쓰고 둘 다 없으면 미분류로 둔다', () => {
    expect(
      prototypeBroadDocumentDomain({
        domain: '',
        title: '스프린트 일정'
      })
    ).toBe('스프린트 일정')
    expect(prototypeBroadDocumentDomain({ domain: null, title: '  보안   권한 검토  ' })).toBe(
      '보안 권한 검토'
    )
    expect(prototypeBroadDocumentDomain({ domain: null, title: '' })).toBe('미분류')
  })
})
