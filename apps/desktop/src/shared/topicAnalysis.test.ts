import { describe, expect, it } from 'vitest'

import {
  assertTopicCatalogFits,
  buildTopicChunkPrompt,
  buildTopicReducePrompt,
  buildTopicWholePrompt,
  parseTopicAnalysis,
  splitTopicAnalysisUtterances
} from './summary'
import type { TopicAnalysisDocument, TopicAnalysisUtterance } from './types'

const utterances: TopicAnalysisUtterance[] = [
  { id: 'u1', speakerLabel: '화자 1', text: 'A는 다음 배포에 포함하기로 결정합니다.', startSec: 1 },
  {
    id: 'u2',
    speakerLabel: '화자 2',
    text: 'B는 비용을 더 확인해야 해서 미결정입니다.',
    startSec: 7
  },
  { id: 'u3', speakerLabel: '화자 1', text: 'C는 오늘 논의하지 않습니다.', startSec: 11 }
]

const documents: TopicAnalysisDocument[] = [
  { id: '11111111-1111-4111-8111-111111111111', title: 'A 도메인', overview: 'A 누적 문서' }
]

const rawResult = JSON.stringify({
  schemaVersion: 1,
  topics: [
    {
      existingDocumentId: documents[0].id,
      newDocumentId: null,
      title: 'A 도메인',
      overview: 'A 배포 포함 여부를 결정했다.',
      decisions: [{ text: 'A는 다음 배포에 포함한다.', sourceUtteranceIds: ['u1'] }],
      unresolved: []
    },
    {
      existingDocumentId: null,
      newDocumentId: null,
      title: 'B 도메인',
      overview: 'B 비용 검토가 남았다.',
      decisions: [],
      unresolved: [{ text: 'B 비용 확인이 필요하다.', sourceUtteranceIds: ['u2'] }]
    }
  ]
})

describe('topic analysis prompts', () => {
  it('기존 문서 목록과 모델용 SOURCE_ID를 프롬프트에 넣는다', () => {
    const prompt = buildTopicWholePrompt({ utterances, documents })

    expect(prompt).toContain(documents[0].id)
    expect(prompt).toContain('SOURCE_ID=S001')
    expect(prompt).toContain('time=00:00:01')
    expect(prompt).not.toContain('{u1}')
    expect(prompt).toContain('sourceUtteranceIds')
    expect(prompt).toContain('newDocumentId": null')
  })

  it('chunk/reduce 프롬프트에는 5개 제한을 두지 않는다', () => {
    const chunkPrompt = buildTopicChunkPrompt({ utterances, documents, index: 0, total: 2 })
    const reducePrompt = buildTopicReducePrompt({
      documents,
      partials: [{ schemaVersion: 1, topics: [] }]
    })

    expect(chunkPrompt).toContain('2개 구간 중 1번째')
    expect(`${chunkPrompt}\n${reducePrompt}`).not.toContain('5개 이내')
  })

  it('reduce 프롬프트에는 chunk 단계에서 앱이 만든 새 문서 id를 노출하지 않고 source id를 alias로 바꾼다', () => {
    const prompt = buildTopicReducePrompt({
      documents,
      utterances,
      partials: [
        {
          schemaVersion: 1,
          topics: [
            {
              existingDocumentId: null,
              newDocumentId: 'app-assigned-id',
              title: '새 주제',
              overview: '새 주제 논의',
              decisions: [],
              unresolved: [{ text: '더 논의한다.', sourceUtteranceIds: ['u2'] }]
            }
          ]
        }
      ]
    })

    expect(prompt).not.toContain('app-assigned-id')
    expect(prompt).not.toContain('"u2"')
    expect(prompt).toContain('"S002"')
    expect(prompt).toContain('"newDocumentId": null')
  })
})

describe('assertTopicCatalogFits', () => {
  it('기존 문서 목록이 예산보다 크면 조용히 누락하지 않고 실패한다', () => {
    expect(() =>
      assertTopicCatalogFits({
        documents: [{ id: 'doc-1', title: 'A'.repeat(40) }],
        budgetChars: 10
      })
    ).toThrow(/기존 문서 목록/)
  })
})

describe('splitTopicAnalysisUtterances', () => {
  it('발화 단위로만 나누고 모든 id를 보존한다', () => {
    const chunks = splitTopicAnalysisUtterances({ utterances, budgetChars: 60 })

    expect(chunks.flat().map((utterance) => utterance.id)).toEqual(['u1', 'u2', 'u3'])
    chunks.forEach((chunk) => expect(chunk.length).toBeGreaterThan(0))
  })
})

describe('parseTopicAnalysis', () => {
  it('모델용 SOURCE_ID를 원래 발화 id로 되돌린다', () => {
    const parsed = parseTopicAnalysis({
      raw: rawResult.replaceAll('"u1"', '"S001"').replaceAll('"u2"', '"S002"'),
      utterances,
      documents,
      createDocumentId: () => '22222222-2222-4222-8222-222222222222'
    })

    expect(parsed.topics[0].decisions[0].sourceUtteranceIds).toEqual(['u1'])
    expect(parsed.topics[1].unresolved[0].sourceUtteranceIds).toEqual(['u2'])
  })

  it('새 topic에는 앱이 만든 UUID를 배정한다', () => {
    const parsed = parseTopicAnalysis({
      raw: rawResult,
      utterances,
      documents,
      createDocumentId: () => '22222222-2222-4222-8222-222222222222'
    })

    expect(parsed.topics[0].existingDocumentId).toBe(documents[0].id)
    expect(parsed.topics[0].newDocumentId).toBeNull()
    expect(parsed.topics[1].existingDocumentId).toBeNull()
    expect(parsed.topics[1].newDocumentId).toBe('22222222-2222-4222-8222-222222222222')
  })

  it('모델이 새 문서 id를 직접 만들면 거절한다', () => {
    const raw = rawResult.replace('"newDocumentId":null', '"newDocumentId":"model-made-id"')

    expect(() =>
      parseTopicAnalysis({ raw, utterances, documents, createDocumentId: () => 'app-id' })
    ).toThrow(/새 문서/)
  })

  it('알 수 없는 발화 id와 문서 id를 거절한다', () => {
    expect(() =>
      parseTopicAnalysis({
        raw: rawResult.replace('"u1"', '"missing-utterance"'),
        utterances,
        documents,
        createDocumentId: () => 'app-id'
      })
    ).toThrow(/알 수 없는 발화 id/)

    expect(() =>
      parseTopicAnalysis({
        raw: rawResult.replace(documents[0].id, 'missing-document'),
        utterances,
        documents,
        createDocumentId: () => 'app-id'
      })
    ).toThrow(/알 수 없는 문서 id/)
  })

  it('타임스탬프를 발화 id처럼 넣으면 거절한다', () => {
    expect(() =>
      parseTopicAnalysis({
        raw: rawResult.replace('"u1"', '"00:00:01"'),
        utterances,
        documents,
        createDocumentId: () => 'app-id'
      })
    ).toThrow(/알 수 없는 발화 id/)
  })
})
