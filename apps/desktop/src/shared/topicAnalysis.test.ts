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
  {
    id: 'u1',
    speakerLabel: '화자 1',
    text: '녹음 파일은 종료 후 바로 업로드하고 처리 상태를 보여주면 좋겠습니다.',
    startSec: 1
  },
  {
    id: 'u2',
    speakerLabel: '화자 2',
    text: '기다리는 시간을 줄이려면 파일을 나누어 보내는 방법도 검토해야 합니다.',
    startSec: 7
  },
  { id: 'u3', speakerLabel: '화자 1', text: 'C는 오늘 논의하지 않습니다.', startSec: 11 }
]

const documents: TopicAnalysisDocument[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    domain: '프로덕트',
    title: '프로덕트',
    overview: '이전 녹음의 누적 문서'
  }
]

const rawResult = JSON.stringify({
  schemaVersion: 2,
  topics: [
    {
      documentId: null,
      domain: '프로덕트',
      title: '녹음 파일 업로드와 처리 속도',
      summarySections: [
        {
          heading: '먼저 구현할 방식',
          text: '녹음 종료 후 파일을 업로드하고 처리 상태를 보여주는 흐름을 논의했다.',
          sourceUtteranceIds: ['u1']
        }
      ],
      outline: [
        {
          heading: '논의 상세',
          items: [
            {
              text: '대기 시간을 줄이는 대안으로 파일 분할 전송을 검토했다.',
              sourceUtteranceIds: ['u2']
            }
          ]
        }
      ]
    }
  ]
})

describe('topic analysis prompts', () => {
  it('기존 문서 목록은 도메인 참고로만 넣고 모델용 SOURCE_ID를 프롬프트에 넣는다', () => {
    const prompt = buildTopicWholePrompt({ utterances, documents })

    expect(prompt).toContain(documents[0].id)
    expect(prompt).toContain('프로덕트 / 프로덕트')
    expect(prompt).toContain('SOURCE_ID=S001')
    expect(prompt).toContain('time=00:00:01')
    expect(prompt).not.toContain('{u1}')
    expect(prompt).toContain('"schemaVersion": 2')
    expect(prompt).toContain('"documentId": null')
    expect(prompt).toContain('기존 문서 id를 결과에 쓰지')
  })

  it('동적 heading과 상세 outline을 요구하고 unsupported claim을 금지한다', () => {
    const chunkPrompt = buildTopicChunkPrompt({ utterances, documents, index: 0, total: 2 })
    const reducePrompt = buildTopicReducePrompt({
      documents,
      partials: [{ schemaVersion: 2, topics: [] }]
    })

    expect(chunkPrompt).toContain('2개 구간 중 1번째')
    expect(`${chunkPrompt}\n${reducePrompt}`).toContain('summarySections')
    expect(`${chunkPrompt}\n${reducePrompt}`).toContain('outline')
    expect(`${chunkPrompt}\n${reducePrompt}`).toContain('회의록에 없는 구현 완료')
    expect(`${chunkPrompt}\n${reducePrompt}`).not.toContain('결정 사항')
    expect(`${chunkPrompt}\n${reducePrompt}`).not.toContain('5개 이내')
  })

  it('reduce 프롬프트에는 앱이 만든 문서 id를 노출하지 않고 source id를 alias로 바꾼다', () => {
    const prompt = buildTopicReducePrompt({
      documents,
      utterances,
      partials: [
        {
          schemaVersion: 2,
          topics: [
            {
              documentId: 'app-assigned-id',
              domain: '프로덕트',
              title: '새 주제',
              summarySections: [
                {
                  heading: '핵심',
                  text: '더 논의한다.',
                  sourceUtteranceIds: ['u2']
                }
              ],
              outline: [
                {
                  heading: '상세',
                  items: [{ text: '검토가 남았다.', sourceUtteranceIds: ['u2'] }]
                }
              ]
            }
          ]
        }
      ]
    })

    expect(prompt).not.toContain('app-assigned-id')
    expect(prompt).not.toContain('"u2"')
    expect(prompt).toContain('"S002"')
    expect(prompt).toContain('"documentId":null')
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
    const chunks = splitTopicAnalysisUtterances({ utterances, budgetChars: 120 })

    expect(chunks.flat().map((utterance) => utterance.id)).toEqual(['u1', 'u2', 'u3'])
    chunks.forEach((chunk) => expect(chunk.length).toBeGreaterThan(0))
  })

  it('예산보다 긴 발화도 원문과 근거 id를 모두 보존해 나눈다', () => {
    const original = { id: 'long', speakerLabel: '화자 1', text: '긴 발화입니다.'.repeat(200) }
    const chunks = splitTopicAnalysisUtterances({ utterances: [original], budgetChars: 200 })
    expect(chunks.length).toBeGreaterThan(1)
    expect(
      chunks
        .flat()
        .map((utterance) => utterance.text)
        .join('')
    ).toBe(original.text)
    expect(chunks.flat().every((utterance) => utterance.id === original.id)).toBe(true)
    expect(chunks.flat().every((utterance) => !/\uFFFD/.test(utterance.text))).toBe(true)
  })
})

describe('parseTopicAnalysis', () => {
  it('V2 모델용 SOURCE_ID를 원래 발화 id로 되돌리고 앱 UUID를 배정한다', () => {
    const parsed = parseTopicAnalysis({
      raw: rawResult.replaceAll('"u1"', '"S001"').replaceAll('"u2"', '"S002"'),
      utterances,
      documents,
      createDocumentId: () => '22222222-2222-4222-8222-222222222222'
    })

    expect(parsed.schemaVersion).toBe(2)
    if (parsed.schemaVersion !== 2) throw new Error('expected V2')
    expect(parsed.topics[0].documentId).toBe('22222222-2222-4222-8222-222222222222')
    expect(parsed.topics[0].summarySections[0].sourceUtteranceIds).toEqual(['u1'])
    expect(parsed.topics[0].outline[0].items[0].sourceUtteranceIds).toEqual(['u2'])
    expect(parsed.topics[0]).not.toHaveProperty('existingDocumentId')
    expect(parsed.topics[0]).not.toHaveProperty('newDocumentId')
    expect(parsed.topics[0]).not.toHaveProperty('decisions')
    expect(parsed.topics[0]).not.toHaveProperty('unresolved')
  })

  it('모델이 새 문서 id를 직접 만들면 거절한다', () => {
    const raw = rawResult.replace('"documentId":null', '"documentId":"model-made-id"')

    expect(() =>
      parseTopicAnalysis({ raw, utterances, documents, createDocumentId: () => 'app-id' })
    ).toThrow(/새 문서/)
  })

  it('알 수 없는 발화 id를 거절한다', () => {
    expect(() =>
      parseTopicAnalysis({
        raw: rawResult.replace('"u1"', '"missing-utterance"'),
        utterances,
        documents,
        createDocumentId: () => 'app-id'
      })
    ).toThrow(/알 수 없는 발화 id/)
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

  it('legacy V1 결과도 읽을 수 있다', () => {
    const parsed = parseTopicAnalysis({
      raw: JSON.stringify({
        schemaVersion: 1,
        topics: [
          {
            existingDocumentId: documents[0].id,
            newDocumentId: null,
            title: 'A 도메인',
            overview: 'A 배포 포함 여부를 결정했다.',
            decisions: [{ text: 'A는 다음 배포에 포함한다.', sourceUtteranceIds: ['S001'] }],
            unresolved: []
          }
        ]
      }),
      utterances,
      documents,
      createDocumentId: () => '22222222-2222-4222-8222-222222222222'
    })

    expect(parsed.schemaVersion).toBe(1)
    if (parsed.schemaVersion !== 1) throw new Error('expected V1')
    expect(parsed.topics[0].existingDocumentId).toBe(documents[0].id)
    expect(parsed.topics[0].decisions[0].sourceUtteranceIds).toEqual(['u1'])
  })
})
