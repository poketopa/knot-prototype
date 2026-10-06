import type { AiAnalysis, AiAnalysisV2 } from './types.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value)
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value))
}

export function validateAiAnalysis(value: unknown): AiAnalysis {
  if (!isObject(value) || !Array.isArray(value.topics)) {
    throw new Error('AI_RESULT_INVALID_SHAPE')
  }

  if (value.schemaVersion === 2) {
    return validateAiAnalysisV2(value)
  }
  if (value.schemaVersion !== 1) {
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

function validateAiAnalysisV2(value: Record<string, unknown>): AiAnalysisV2 {
  if (!Array.isArray(value.topics)) {
    throw new Error('AI_RESULT_INVALID_SHAPE')
  }
  return {
    schemaVersion: 2,
    topics: value.topics.map((topic) => {
      if (!isObject(topic)) {
        throw new Error('AI_TOPIC_INVALID')
      }
      if (!isUuid(topic.documentId)) {
        throw new Error('AI_TOPIC_DOCUMENT_ID_INVALID')
      }
      if (typeof topic.domain !== 'string' || topic.domain.trim().length === 0) {
        throw new Error('AI_TOPIC_DOMAIN_REQUIRED')
      }
      if (typeof topic.title !== 'string' || topic.title.trim().length === 0) {
        throw new Error('AI_TOPIC_TITLE_REQUIRED')
      }
      const summarySections = validateSummarySections(topic.summarySections)
      const outline = validateOutline(topic.outline)
      if (summarySections.length === 0 && outline.length === 0) {
        throw new Error('AI_TOPIC_BODY_EMPTY')
      }
      return {
        documentId: topic.documentId,
        domain: topic.domain,
        title: topic.title,
        summarySections,
        outline
      }
    })
  }
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

function validateSummarySections(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error('AI_SUMMARY_SECTIONS_INVALID')
  }
  return value.map((section) => {
    if (
      !isObject(section) ||
      typeof section.heading !== 'string' ||
      section.heading.trim().length === 0 ||
      typeof section.text !== 'string'
    ) {
      throw new Error('AI_SUMMARY_SECTION_INVALID')
    }
    return {
      heading: section.heading,
      text: section.text,
      sourceUtteranceIds: validateSourceUtteranceIds(section.sourceUtteranceIds)
    }
  })
}

function validateOutline(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error('AI_OUTLINE_INVALID')
  }
  return value.map((section) => {
    if (
      !isObject(section) ||
      typeof section.heading !== 'string' ||
      section.heading.trim().length === 0 ||
      !Array.isArray(section.items) ||
      section.items.length === 0
    ) {
      throw new Error('AI_OUTLINE_SECTION_INVALID')
    }
    return {
      heading: section.heading,
      items: section.items.map((item) => {
        if (!isObject(item) || typeof item.text !== 'string') {
          throw new Error('AI_OUTLINE_ITEM_INVALID')
        }
        return {
          text: item.text,
          sourceUtteranceIds: validateSourceUtteranceIds(item.sourceUtteranceIds)
        }
      })
    }
  })
}

function validateSourceUtteranceIds(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('AI_SOURCE_UTTERANCE_IDS_INVALID')
  }
  return value.map((id) => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('AI_SOURCE_UTTERANCE_ID_INVALID')
    }
    return id
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
