import { describe, expect, it } from 'vitest'
import { mergeTopicPartials } from './mergeTopicPartials'
import type { TopicAnalysisResultV2 } from '@shared/types'

const partial = (id: string, title = '주말 여행'): TopicAnalysisResultV2 => ({
  schemaVersion: 2,
  topics: [
    {
      documentId: id,
      domain: '여행',
      title,
      summarySections: [
        { heading: '일정', text: `${id}에서 논의한 일정`.repeat(1000), sourceUtteranceIds: [id] }
      ],
      outline: [
        { heading: '이유', items: [{ text: `${id}의 선택 이유`, sourceUtteranceIds: [id] }] }
      ]
    }
  ]
})

describe('mergeTopicPartials', () => {
  it('모델 입력보다 큰 결과도 첫 구간부터 마지막 구간까지 삭제하지 않고 연결한다', () => {
    const inputs = Array.from({ length: 100 }, (_, i) => partial(`source-${i}`))
    const originals = JSON.stringify(inputs)
    const result = mergeTopicPartials(inputs)
    expect(result.topics).toHaveLength(1)
    expect(result.topics[0].summarySections).toHaveLength(100)
    expect(result.topics[0].outline[0].items).toHaveLength(100)
    expect(result.topics[0].summarySections[99]).toEqual(inputs[99].topics[0].summarySections[0])
    expect(JSON.stringify(inputs)).toBe(originals)
  })

  it('다른 도메인이나 다른 제목은 별도 문서로 보존한다', () => {
    const differentDomain = partial('3')
    differentDomain.topics[0].domain = '일상'
    expect(
      mergeTopicPartials([partial('1'), partial('2', '출장'), differentDomain]).topics
    ).toHaveLength(3)
  })

  it('같은 내용의 중복은 모든 근거를 유지하면서 합친다', () => {
    const a = partial('1')
    const b = structuredClone(a)
    b.topics[0].documentId = '2'
    b.topics[0].summarySections[0].sourceUtteranceIds = ['2']
    b.topics[0].outline[0].items[0].sourceUtteranceIds = ['2']
    const [topic] = mergeTopicPartials([a, b]).topics
    expect(topic.summarySections).toHaveLength(1)
    expect(topic.summarySections[0].sourceUtteranceIds).toEqual(['1', '2'])
    expect(topic.outline[0].items[0].sourceUtteranceIds).toEqual(['1', '2'])
  })
})
