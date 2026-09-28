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
})

describe('canonicalJson', () => {
  it('orders object keys consistently', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}')
  })
})
