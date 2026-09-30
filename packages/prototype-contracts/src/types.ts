export type Uuid = string
export type IsoDateTime = string

export type ErrorResponse = {
  code: string
  message: string
  retryable: boolean
  requestId: string
}

export type AuthAttemptRequest = {
  challenge: string
}

export type AuthAttemptResponse = {
  attemptId: Uuid
  authorizeUrl: string
  expiresAt: IsoDateTime
}

export type AuthExchangeRequest = {
  attemptId: Uuid
  ticket: string
  verifier: string
}

export type UserResponse = {
  id: Uuid
  displayName: string
}

export type AuthExchangeResponse = {
  session: {
    token: string
    expiresAt: IsoDateTime
  }
  user: UserResponse
}

export type RecordingPutRequest = {
  startedAt: IsoDateTime
  endedAt: IsoDateTime
  durationMs: number
  title?: string
}

export type RecordingResponse = {
  id: Uuid
  startedAt: IsoDateTime
  endedAt: IsoDateTime
  durationMs: number
  title: string | null
  publishedAnalysisId: Uuid | null
}

export type ArtifactKind =
  'wav' | 'transcript' | 'ai_raw' | 'ai_analysis' | 'ai_partial' | 'meeting_summary'

export type ArtifactPutRequest = {
  kind: ArtifactKind
  attemptId?: string
  content?: unknown
  sha256: string
  byteLength: number
  provider?: string
  model?: string
  promptVersion?: string
}

export type ArtifactResponse = {
  id: Uuid
  recordingId: Uuid
  kind: ArtifactKind
  sha256: string
  byteLength: number
  provider: string | null
  model: string | null
  promptVersion: string | null
  completed: boolean
}

export type UploadStartResponse = {
  method: 'PUT'
  url: string
  expiresAt: IsoDateTime
}

export type UploadReceiptResponse = {
  id: Uuid
  sha256: string
  byteLength: number
}

export type PublishRequest = {
  analysisArtifactId: Uuid
  transcriptArtifactId?: Uuid
}

export type AiDecisionItem = {
  text: string
  sourceUtteranceIds: string[]
}

export type AiTopic = {
  existingDocumentId: Uuid | null
  newDocumentId: Uuid | null
  title: string
  overview: string
  decisions: AiDecisionItem[]
  unresolved: AiDecisionItem[]
}

export type AiAnalysisV1 = {
  schemaVersion: 1
  topics: AiTopic[]
}

export type AiSummarySection = {
  heading: string
  text: string
  sourceUtteranceIds: string[]
}

export type AiOutlineItem = {
  text: string
  sourceUtteranceIds: string[]
}

export type AiOutlineSection = {
  heading: string
  items: AiOutlineItem[]
}

export type AiTopicV2 = {
  documentId: Uuid
  domain: string
  title: string
  summarySections: AiSummarySection[]
  outline: AiOutlineSection[]
}

export type AiAnalysisV2 = {
  schemaVersion: 2
  topics: AiTopicV2[]
}

export type AiAnalysis = AiAnalysisV1 | AiAnalysisV2

export type DocumentSummary = {
  id: Uuid
  title: string
  latestVersion: number
  updatedAt: IsoDateTime
}

export type DocumentSection = {
  recordingId: Uuid
  recordingStartedAt: IsoDateTime
  overview: string
  decisions: AiDecisionItem[]
  unresolved: AiDecisionItem[]
}

export type DocumentDetail = DocumentSummary & {
  body: {
    sections: DocumentSection[]
  }
  snapshotId: Uuid
}

export type PublishResponse = {
  documents: DocumentSummary[]
}

export type DocumentTreeItem = {
  id: Uuid
  title: string
  domain: string
  recordingId: Uuid
  recordingStartedAt: IsoDateTime
  latestVersion: number
  updatedAt: IsoDateTime
  overview?: string
}

export type DocumentTreeDetail = DocumentTreeItem & {
  body: {
    schemaVersion: 2
    summarySections: AiSummarySection[]
    outline: AiOutlineSection[]
  }
  transcriptArtifactId: Uuid
  snapshotId: Uuid
}

export type EventType =
  | 'login_succeeded'
  | 'recording_started'
  | 'recording_finished'
  | 'processing_stage_succeeded'
  | 'processing_stage_failed'
  | 'document_viewed'
  | 'transcript_viewed'
  | 'copied'

export type AnalyticsEvent = {
  eventId: Uuid
  eventType: EventType
  occurredAt: IsoDateTime
  recordingId?: Uuid
  documentId?: Uuid
  version?: number
  attemptId?: string
  durationMs?: number
  errorCode?: string
  metadata?: {
    stage?:
      'recording' | 'transcription' | 'ai_analysis' | 'document_publish' | 'sync' | 'copy' | 'view'
  }
}

export type EventsBatchRequest = {
  events: AnalyticsEvent[]
}

export type EventsBatchResponse = {
  accepted: Uuid[]
}
