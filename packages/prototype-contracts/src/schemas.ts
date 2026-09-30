const uuid = {
  type: 'string',
  format: 'uuid'
} as const

const isoDateTime = {
  type: 'string',
  format: 'date-time'
} as const

const sha256 = {
  type: 'string',
  pattern: '^[a-f0-9]{64}$'
} as const

const noExtra = {
  additionalProperties: false
} as const

export const errorResponseSchema = {
  type: 'object',
  required: ['code', 'message', 'retryable', 'requestId'],
  properties: {
    code: { type: 'string' },
    message: { type: 'string' },
    retryable: { type: 'boolean' },
    requestId: { type: 'string' }
  },
  ...noExtra
} as const

export const authAttemptRequestSchema = {
  type: 'object',
  required: ['challenge'],
  properties: {
    challenge: { type: 'string', minLength: 43, maxLength: 128 }
  },
  ...noExtra
} as const

export const authExchangeRequestSchema = {
  type: 'object',
  required: ['attemptId', 'ticket', 'verifier'],
  properties: {
    attemptId: uuid,
    ticket: { type: 'string', minLength: 32 },
    verifier: { type: 'string', minLength: 43, maxLength: 128 }
  },
  ...noExtra
} as const

export const recordingPutRequestSchema = {
  type: 'object',
  required: ['startedAt', 'endedAt', 'durationMs'],
  properties: {
    startedAt: isoDateTime,
    endedAt: isoDateTime,
    durationMs: { type: 'integer', minimum: 0 },
    title: { type: 'string', minLength: 1, maxLength: 200 }
  },
  ...noExtra
} as const

export const artifactPutRequestSchema = {
  type: 'object',
  required: ['kind', 'sha256', 'byteLength'],
  properties: {
    kind: {
      type: 'string',
      enum: ['wav', 'transcript', 'ai_raw', 'ai_analysis', 'ai_partial', 'meeting_summary']
    },
    attemptId: { type: 'string', minLength: 1, maxLength: 128 },
    content: {},
    sha256,
    byteLength: { type: 'integer', minimum: 0 },
    provider: { type: 'string', minLength: 1, maxLength: 80 },
    model: { type: 'string', minLength: 1, maxLength: 120 },
    promptVersion: { type: 'string', minLength: 1, maxLength: 80 }
  },
  ...noExtra
} as const

export const publishRequestSchema = {
  type: 'object',
  required: ['analysisArtifactId'],
  properties: {
    analysisArtifactId: uuid,
    transcriptArtifactId: uuid,
    replaceRecordingDocuments: { type: 'boolean' }
  },
  ...noExtra
} as const

export const aiDecisionItemSchema = {
  type: 'object',
  required: ['text', 'sourceUtteranceIds'],
  properties: {
    text: { type: 'string', minLength: 1 },
    sourceUtteranceIds: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', minLength: 1 },
      uniqueItems: true
    }
  },
  ...noExtra
} as const

export const aiTopicSchema = {
  type: 'object',
  required: ['existingDocumentId', 'newDocumentId', 'title', 'overview', 'decisions', 'unresolved'],
  properties: {
    existingDocumentId: { anyOf: [uuid, { type: 'null' }] },
    newDocumentId: { anyOf: [uuid, { type: 'null' }] },
    title: { type: 'string', minLength: 1, maxLength: 160 },
    overview: { type: 'string' },
    decisions: { type: 'array', items: aiDecisionItemSchema },
    unresolved: { type: 'array', items: aiDecisionItemSchema }
  },
  ...noExtra
} as const

export const aiAnalysisV1Schema = {
  type: 'object',
  required: ['schemaVersion', 'topics'],
  properties: {
    schemaVersion: { const: 1 },
    topics: { type: 'array', items: aiTopicSchema }
  },
  ...noExtra
} as const

export const aiSummarySectionSchema = {
  type: 'object',
  required: ['heading', 'text', 'sourceUtteranceIds'],
  properties: {
    heading: { type: 'string', minLength: 1, maxLength: 160 },
    text: { type: 'string' },
    sourceUtteranceIds: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', minLength: 1 },
      uniqueItems: true
    }
  },
  ...noExtra
} as const

export const aiOutlineItemSchema = {
  type: 'object',
  required: ['text', 'sourceUtteranceIds'],
  properties: {
    text: { type: 'string' },
    sourceUtteranceIds: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      uniqueItems: true
    }
  },
  ...noExtra
} as const

export const aiOutlineSectionSchema = {
  type: 'object',
  required: ['heading', 'items'],
  properties: {
    heading: { type: 'string', minLength: 1, maxLength: 160 },
    items: { type: 'array', minItems: 1, items: aiOutlineItemSchema }
  },
  ...noExtra
} as const

export const aiTopicV2Schema = {
  type: 'object',
  required: ['documentId', 'domain', 'title', 'summarySections', 'outline'],
  properties: {
    documentId: uuid,
    domain: { type: 'string', minLength: 1, maxLength: 160 },
    title: { type: 'string', minLength: 1, maxLength: 160 },
    summarySections: { type: 'array', minItems: 1, items: aiSummarySectionSchema },
    outline: { type: 'array', minItems: 1, items: aiOutlineSectionSchema }
  },
  ...noExtra
} as const

export const aiAnalysisV2Schema = {
  type: 'object',
  required: ['schemaVersion', 'topics'],
  properties: {
    schemaVersion: { const: 2 },
    topics: { type: 'array', items: aiTopicV2Schema }
  },
  ...noExtra
} as const

export const eventsBatchRequestSchema = {
  type: 'object',
  required: ['events'],
  properties: {
    events: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      items: {
        type: 'object',
        required: ['eventId', 'eventType', 'occurredAt'],
        properties: {
          eventId: uuid,
          eventType: {
            type: 'string',
            enum: [
              'login_succeeded',
              'recording_started',
              'recording_finished',
              'processing_stage_succeeded',
              'processing_stage_failed',
              'document_viewed',
              'transcript_viewed',
              'copied'
            ]
          },
          occurredAt: isoDateTime,
          recordingId: uuid,
          documentId: uuid,
          version: { type: 'integer', minimum: 1 },
          attemptId: { type: 'string', minLength: 1, maxLength: 128 },
          durationMs: { type: 'integer', minimum: 0 },
          errorCode: { type: 'string', minLength: 1, maxLength: 80 },
          metadata: {
            type: 'object',
            properties: {
              stage: {
                type: 'string',
                enum: [
                  'recording',
                  'transcription',
                  'ai_analysis',
                  'document_publish',
                  'sync',
                  'copy',
                  'view'
                ]
              }
            },
            additionalProperties: false
          }
        },
        ...noExtra
      }
    }
  },
  ...noExtra
} as const
