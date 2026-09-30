import type { Utterance } from './types'

const DOMAIN_RULES: Array<{ domain: string; keywords: string[] }> = [
  {
    domain: 'AI',
    keywords: [
      'ai',
      'gpt',
      'llm',
      '모델',
      '전사',
      '요약',
      '정리',
      '분석',
      '화자',
      'stt',
      'claude',
      'codex',
      '프롬프트'
    ]
  },
  {
    domain: '문서',
    keywords: ['문서', '기록', '회의록', '템플릿', '원문', '노션', '누적', '보관', '정책']
  },
  {
    domain: '개발',
    keywords: [
      '개발',
      '구현',
      '배포',
      'api',
      'backend',
      'frontend',
      '서버',
      'db',
      's3',
      'aws',
      '업로드',
      '저장',
      '품질',
      'qa'
    ]
  },
  {
    domain: '탐색',
    keywords: ['탐색', '검증', '사용자', '인터뷰', '리서치', '실험', '가설', '가치', '문제']
  },
  {
    domain: '독서',
    keywords: ['독서', '책', '철학', '글쓰기', '읽기', '사유', '삶']
  }
]

const BROAD_DOMAIN_NAMES = new Set(DOMAIN_RULES.map((rule) => rule.domain))

export const prototypeBroadDocumentDomain = ({
  domain,
  title
}: {
  domain?: string | null
  title?: string | null
  overview?: string | null
}) => {
  const existing = domain?.trim()
  if (existing && BROAD_DOMAIN_NAMES.has(existing)) return existing

  const text = [domain, title].filter(Boolean).join(' ').toLowerCase()
  const match = DOMAIN_RULES.find((rule) =>
    rule.keywords.some((keyword) => text.includes(keyword.toLowerCase()))
  )
  if (match) return match.domain

  if (existing && existing.length <= 8 && !/\s/.test(existing)) return existing

  return '기타'
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
