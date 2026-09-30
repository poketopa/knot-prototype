import { describe, expect, it } from 'vitest'

import { prototypeBroadDocumentDomain } from './prototype'

describe('prototypeBroadDocumentDomain', () => {
  it('좁은 문서 제목을 큰 탐색 도메인으로 묶는다', () => {
    expect(
      prototypeBroadDocumentDomain({
        domain: '회의 문서 템플릿 적용 방식',
        title: '결정 문서 구조',
        overview: '회의록과 원문을 문서로 보관하는 방식을 논의했다.'
      })
    ).toBe('문서')
    expect(
      prototypeBroadDocumentDomain({
        domain: '녹음 분석 품질과 AI 성능 개선',
        title: '화자 분리 모델 개선'
      })
    ).toBe('AI')
    expect(
      prototypeBroadDocumentDomain({
        domain: '개발 단위 및 개발 순서 결정',
        title: '서버 배포와 업로드 QA'
      })
    ).toBe('개발')
  })

  it('이미 큰 도메인이면 그대로 유지한다', () => {
    expect(prototypeBroadDocumentDomain({ domain: '독서', title: '철학 대화' })).toBe('독서')
  })

  it('알 수 없는 긴 제목형 도메인은 좁은 루트로 두지 않고 기타로 묶는다', () => {
    expect(
      prototypeBroadDocumentDomain({
        domain: '우선순위와 다음주 일정 논의',
        title: '스프린트 일정'
      })
    ).toBe('기타')
    expect(prototypeBroadDocumentDomain({ domain: '보안', title: '권한 검토' })).toBe('보안')
  })
})
