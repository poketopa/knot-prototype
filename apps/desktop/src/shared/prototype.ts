import type { Utterance } from './types'

export interface PrototypeUser {
  id: string
  displayName: string
}

export interface PrototypeAuthState {
  isAuthenticated: boolean
  user: PrototypeUser | null
  error?: string
  isSyncPaused?: boolean
}

export interface PrototypeDocumentListItem {
  id: string
  title: string
  latestVersion: number
  updatedAt: string
  overview?: string
}

export interface PrototypeDecisionItem {
  text: string
  sourceUtteranceIds: string[]
}

export interface PrototypeDocumentSection {
  overview: string
  decisions: PrototypeDecisionItem[]
  unresolved: PrototypeDecisionItem[]
}

export interface PrototypeDocumentContribution {
  recordingId: string
  startedAt: string
  section: PrototypeDocumentSection
}

export interface PrototypeDocumentDetail {
  id: string
  title: string
  version: number
  body: string
  contributions: PrototypeDocumentContribution[]
  offline?: boolean
}

export interface PrototypeTranscript {
  recordingId: string
  title: string
  startedAt: string
  durationSec?: number
  utterances: Utterance[]
}

export type PrototypeProcessingStage =
  'recording' | 'transcribing' | 'summarizing' | 'publishing' | 'syncing' | 'done' | 'error'

export interface PrototypeProcessingItem {
  meetingId: string
  title: string
  status: 'pending' | 'running' | 'succeeded' | 'failed'
  stage: PrototypeProcessingStage
  error?: string
  saved?: boolean
}

export type PrototypeEventType =
  | 'login_succeeded'
  | 'recording_started'
  | 'recording_finished'
  | 'processing_stage_succeeded'
  | 'processing_stage_failed'
  | 'document_viewed'
  | 'transcript_viewed'
  | 'copied'

export interface PrototypeTrackEventRequest {
  eventId?: string
  eventType: PrototypeEventType
  occurredAt?: string
  recordingId?: string
  documentId?: string
  version?: number
  stage?: PrototypeProcessingStage
  attemptId?: string
  durationMs?: number
  errorCode?: string
}

export interface PrototypeChangedEvent {
  reason: 'auth' | 'documents' | 'processing' | 'sync' | 'recording' | 'transcript' | 'event'
  recordingId?: string
  documentId?: string
}
