import { describe, expect, it } from 'vitest'

import { canonicalJson, validateAiAnalysis } from './validate.js'

describe('validateAiAnalysis', () => {
  it('accepts topic documents with exactly one document id', () => {
    const result = validateAiAnalysis({
      schemaVersion: 1,
      topics: [
        {
          existingDocumentId: null,
          newDocumentId: '550e8400-e29b-41d4-a716-446655440000',
          title: 'A',
          overview: '',
          decisions: [{ text: '결정', sourceUtteranceIds: ['u1'] }],
          unresolved: []
        }
      ]
    })

    expect(result.topics).toHaveLength(1)
  })

  it('rejects ambiguous document identity', () => {
    expect(() =>
      validateAiAnalysis({
        schemaVersion: 1,
        topics: [
          {
            existingDocumentId: null,
            newDocumentId: null,
            title: 'A',
            overview: '',
            decisions: [],
            unresolved: []
          }
        ]
      })
    ).toThrow('AI_TOPIC_DOCUMENT_ID_AMBIGUOUS')
  })

  it('keeps V1 source compatibility while requiring grounded V2 sections', () => {
    expect(
      validateAiAnalysis({
        schemaVersion: 1,
        topics: [
          {
            existingDocumentId: null,
            newDocumentId: '550e8400-e29b-41d4-a716-446655440000',
            title: 'A',
            overview: '',
            decisions: [{ text: 'legacy empty refs allowed', sourceUtteranceIds: [] }],
            unresolved: []
          }
        ]
      })
    ).toMatchObject({ schemaVersion: 1 })

    expect(() =>
      validateAiAnalysis({
        schemaVersion: 2,
        topics: [
          {
            documentId: '550e8400-e29b-41d4-a716-446655440001',
            domain: '제품',
            title: 'A',
            summarySections: [],
            outline: [
              {
                heading: '논의',
                items: [{ text: '상세', sourceUtteranceIds: ['u1'] }]
              }
            ]
          }
        ]
      })
    ).toThrow('AI_SUMMARY_SECTIONS_INVALID')

    expect(() =>
      validateAiAnalysis({
        schemaVersion: 2,
        topics: [
          {
            documentId: '550e8400-e29b-41d4-a716-446655440001',
            domain: '제품',
            title: 'A',
            summarySections: [{ heading: '핵심', text: '요약', sourceUtteranceIds: [] }],
            outline: [{ heading: '논의', items: [] }]
          }
        ]
      })
    ).toThrow('AI_SOURCE_UTTERANCE_IDS_INVALID')
  })
})

describe('short conversation analysis', () => {
  it('accepts a sourced summary without inventing outline details', () => {
    expect(
      validateAiAnalysis({
        schemaVersion: 2,
        topics: [
          {
            documentId: '550e8400-e29b-41d4-a716-446655440001',
            domain: '일상',
            title: '짧은 대화',
            summarySections: [
              { heading: '대화 내용', text: '오늘의 안부를 나눴어요.', sourceUtteranceIds: ['u1'] }
            ],
            outline: []
          }
        ]
      })
    ).toMatchObject({ schemaVersion: 2, topics: [{ outline: [] }] })
  })
})

describe('canonicalJson', () => {
  it('orders object keys consistently', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}')
  })
})
