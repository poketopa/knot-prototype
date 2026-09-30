import type { Utterance } from './types'

export const prototypeBroadDocumentDomain = ({
  domain,
  title
}: {
  domain?: string | null
  title?: string | null
  overview?: string | null
}) => {
  const normalized = domain?.trim().replace(/\s+/g, ' ')
  if (normalized) return normalized

  return title?.trim().replace(/\s+/g, ' ') || '미분류'
}

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
  domain?: string
  recordingId?: string
  recordingStartedAt?: string
}

export interface PrototypeSummarySection {
  heading: string
  text: string
  sourceUtteranceIds: string[]
}

export interface PrototypeOutlineSection {
  heading: string
  items: PrototypeDecisionItem[]
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
  domain?: string
  recordingId?: string
  recordingStartedAt?: string
  durationSec?: number
  transcriptArtifactId?: string
  summarySections?: PrototypeSummarySection[]
  outline?: PrototypeOutlineSection[]
}

export interface PrototypeTranscript {
  recordingId: string
  title: string
  startedAt: string
  durationSec?: number
  utterances: Utterance[]
}

export interface PrototypeMeetingSummary {
  recordingId: string
  title: string
  startedAt: string
  durationSec: number
  status: 'recording' | 'processing' | 'ready' | 'empty' | 'failed'
  headline?: string
  body?: string
  error?: string
  hasTranscript: boolean
  refreshStatus?: 'queued' | 'running'
  refreshError?: string
}

export type PrototypeProcessingStage =
  'recording' | 'transcribing' | 'summarizing' | 'publishing' | 'syncing' | 'done' | 'error'

export interface PrototypeProcessingItem {
  meetingId: string
  title: string
  startedAt?: string
  status: 'pending' | 'running' | 'succeeded' | 'failed'
  stage: PrototypeProcessingStage
  error?: string
  saved?: boolean
  completedStages?: Array<'recording' | 'transcribing' | 'summarizing' | 'syncing'>
  hasTranscript?: boolean
  syncError?: string
  canRetry?: boolean
  recordingWarning?: string
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
