import type { AiAnalysisV1 } from './types.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value)
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value))
}

export function validateAiAnalysis(value: unknown): AiAnalysisV1 {
  if (!isObject(value) || value.schemaVersion !== 1 || !Array.isArray(value.topics)) {
    throw new Error('AI_RESULT_INVALID_SHAPE')
  }

  const topics = value.topics.map((topic) => {
    if (!isObject(topic)) {
      throw new Error('AI_TOPIC_INVALID')
    }
    const existingDocumentId = topic.existingDocumentId
    const newDocumentId = topic.newDocumentId
    const hasExisting = existingDocumentId !== null
    const hasNew = newDocumentId !== null
    if (hasExisting === hasNew) {
      throw new Error('AI_TOPIC_DOCUMENT_ID_AMBIGUOUS')
    }
    if (hasExisting && !isUuid(existingDocumentId)) {
      throw new Error('AI_TOPIC_EXISTING_DOCUMENT_ID_INVALID')
    }
    if (hasNew && !isUuid(newDocumentId)) {
      throw new Error('AI_TOPIC_NEW_DOCUMENT_ID_INVALID')
    }
    if (typeof topic.title !== 'string' || topic.title.trim().length === 0) {
      throw new Error('AI_TOPIC_TITLE_REQUIRED')
    }
    if (typeof topic.overview !== 'string') {
      throw new Error('AI_TOPIC_OVERVIEW_INVALID')
    }
    return {
      existingDocumentId,
      newDocumentId,
      title: topic.title,
      overview: topic.overview,
      decisions: validateItems(topic.decisions),
      unresolved: validateItems(topic.unresolved)
    }
  })

  return { schemaVersion: 1, topics }
}

function validateItems(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error('AI_ITEMS_INVALID')
  }
  return value.map((item) => {
    if (
      !isObject(item) ||
      typeof item.text !== 'string' ||
      !Array.isArray(item.sourceUtteranceIds)
    ) {
      throw new Error('AI_ITEM_INVALID')
    }
    return {
      text: item.text,
      sourceUtteranceIds: item.sourceUtteranceIds.map((id) => {
        if (typeof id !== 'string' || id.length === 0) {
          throw new Error('AI_SOURCE_UTTERANCE_ID_INVALID')
        }
        return id
      })
    }
  })
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson)
  }
  if (!isObject(value)) {
    return value
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJson(value[key])])
  )
}
