/**
 * 이 앱의 제품 타입. 파이프라인 중간 산출물 타입은 두 앱이 공유하므로
 * `@meeting-stt/core/types`에 있고, 모델 종류는 `@meeting-stt/models/desktop`에 있다.
 * 기존 import 경로(`@shared/types`)를 유지하려고 여기서 함께 재노출한다.
 */

import type { MergedUtterance } from '@meeting-stt/core/types'

export type {
  MergedUtterance,
  SpeakerPiece,
  SpeakerSegment,
  SttSegment,
  SttWord
} from '@meeting-stt/core/types'
export type { ModelKey, WhisperModelId } from '@meeting-stt/models/desktop'

export type MeetingStatus = 'recording' | 'processing' | 'done' | 'error'

export interface Meeting {
  id: string
  title: string
  createdAt: number
  durationSec: number
  status: MeetingStatus
  errorMessage?: string
  summary?: string
  /** 녹음 정지 시 입력한 참석자 수. 없으면 임계값 폴백으로 화자를 나눈 회의다 (references/data-model.md) */
  speakerCount?: number
}

export interface Utterance extends MergedUtterance {
  id: string
  meetingId: string
}

export interface Speaker {
  meetingId: string
  label: string
  displayName: string | null
}

/** 사용자 설정. main의 settings 테이블에 키별 JSON으로 저장한다 (references/data-model.md) */
export interface AppSettings {
  /** 파이프라인이 성공한 뒤 원본 WAV를 남길지. 기본은 삭제(false) */
  isAudioKept: boolean
  /** 앱 시작 시 새 버전을 확인할지. 기본은 꺼짐 — 네트워크는 모델 다운로드 한 번뿐이라는 약속 때문이다 */
  isUpdateCheckEnabled: boolean
  /** 녹음 토글 전역 단축키 (Electron accelerator, `src/shared/shortcut.ts`) */
  recordingShortcut: string
}

/**
 * 전역 용어 사전 (Phase 5-4). `AppSettings`와 따로 `glossary:get`/`glossary:update`로 오간다 (references/data-model.md).
 * 용어 한 줄은 `용어` 또는 `영어 표기 = 읽기1, 읽기2` 형식이다.
 */
export interface GlossarySettings {
  /** 초안 생성의 입력이 되는 팀 소개 */
  teamDescription: string
  terms: string[]
}

/**
 * 요약·용어 초안이 쓰는 LLM 공급자 (references/architecture.md "LLM 공급자").
 * 'local'은 llama.cpp, 나머지는 사용자의 Claude API 키·Claude Code CLI(구독)·OpenAI API 키다.
 */
export type LlmProvider = 'local' | 'claude-api' | 'claude-cli' | 'openai-api' | 'codex-cli'

/** API 키를 저장하는 단위. 공급자가 아니라 회사별이라 공급자를 오가도 키를 다시 넣지 않는다 */
export type LlmApiVendor = 'anthropic' | 'openai'

/** `openai-api`가 부르는 GPT 모델. 목록·라벨은 `src/shared/llm.ts`의 OPENAI_MODELS */
export type OpenaiModelId = 'gpt-6-astra' | 'gpt-6-sol' | 'gpt-6-luna'

/** 저장된 키의 유무와 마지막 4자. 키 자체는 renderer로 보내지 않는다 */
export interface LlmApiKeyStatus {
  isSaved: boolean
  tail: string | null
}

/**
 * `llm:status` 응답. API 키 자체는 renderer로 보내지 않고 회사별 유무와 마지막 4자만 준다.
 * 공급자는 `AppSettings`와 따로 자기 채널로 오간다 (references/data-model.md).
 */
export interface LlmStatus {
  provider: LlmProvider
  /** llama-cli와 요약 모델이 모두 있는지 */
  isLocalModelReady: boolean
  apiKeys: Record<LlmApiVendor, LlmApiKeyStatus>
  openaiModel: OpenaiModelId
  /** 찾은 `claude` 실행 파일. 없으면 null */
  claudeCliPath: string | null
  claudeCliVersion: string | null
  /** 찾은 `codex` 실행 파일. 없으면 null */
  codexCliPath?: string | null
  codexCliVersion?: string | null
  /** untrusted transcript를 넘겨도 파일·셸·MCP 도구가 꺼진다고 확인됐는지 */
  isCodexCliSandboxSupported?: boolean
  codexCliUnsupportedReason?: string | null
}

export interface TopicAnalysisUtterance {
  id: string
  speakerLabel: string
  text: string
  startSec?: number
}

export interface TopicAnalysisDocument {
  id: string
  domain?: string
  title: string
  overview?: string
}

export interface TopicAnalysisPoint {
  text: string
  sourceUtteranceIds: string[]
}

export interface TopicAnalysisTopic {
  existingDocumentId: string | null
  newDocumentId: string | null
  title: string
  overview: string
  decisions: TopicAnalysisPoint[]
  unresolved: TopicAnalysisPoint[]
}

export interface TopicAnalysisResultV1 {
  schemaVersion: 1
  topics: TopicAnalysisTopic[]
}

export interface TopicAnalysisSourceSection {
  heading: string
  text: string
  sourceUtteranceIds: string[]
}

export interface TopicAnalysisOutlineItem {
  text: string
  sourceUtteranceIds: string[]
}

export interface TopicAnalysisOutlineSection {
  heading: string
  items: TopicAnalysisOutlineItem[]
}

export interface TopicAnalysisGeneratedTopic {
  documentId: string
  domain: string
  title: string
  summarySections: TopicAnalysisSourceSection[]
  outline: TopicAnalysisOutlineSection[]
  /** Legacy reader compatibility only. New V2 JSON emitted by runTopicAnalysis does not include this field. */
  overview: string
  /** Legacy reader compatibility only. New V2 JSON emitted by runTopicAnalysis does not include this field. */
  decisions: TopicAnalysisPoint[]
  /** Legacy reader compatibility only. New V2 JSON emitted by runTopicAnalysis does not include this field. */
  unresolved: TopicAnalysisPoint[]
}

export interface TopicAnalysisResultV2 {
  schemaVersion: 2
  topics: TopicAnalysisGeneratedTopic[]
}

export type TopicAnalysisResult = TopicAnalysisResultV1 | TopicAnalysisResultV2

export interface TopicAnalysisAttempt {
  id: string
  provider: LlmProvider
  model: string | null
  promptVersion: string
  rawResponses: Array<{ label: string; text: string }>
  partialResults: TopicAnalysisResult[]
  result: TopicAnalysisResult
}

/** 디테일 화면이 한 번에 받는 묶음 */
export interface MeetingDetail {
  meeting: Meeting
  utterances: Utterance[]
  speakers: Speaker[]
}

/**
 * 파이프라인 단계. VAD는 whisper에 내장돼 별도 단계가 없고,
 * 'done'·'error'는 잡이 끝날 때 한 번만 보내는 종료 상태다.
 */
export type PipelineStage = 'stt' | 'diarize' | 'merge' | 'save' | 'done' | 'error'

/**
 * 요약 단계 (Phase 5). 'summarize'는 회의록 전체 또는 구간별 부분 요약,
 * 'reduce'는 부분 요약을 하나로 합치는 단계다. 'done'·'error'는 마지막에 한 번만 보낸다.
 */
export type SummaryStage = 'summarize' | 'reduce' | 'done' | 'error'

/** 교정 대상 발화 하나 (Phase 5-4). 화자 라벨은 넘기지 않는다 — 모델이 고칠 대상이 아니다 */
export interface RefineSource {
  id: string
  text: string
}

/**
 * 치환 후보 한 쌍. 발화의 `from`이 용어 사전의 `to`를 잘못 받아 적은 것일 수 있다는 뜻이다.
 * 코드가 발음 유사도로 만들고, LLM이 문맥을 보고 맞는지 판정한다 (docs/phase5-refine-results.md)
 */
export interface RefinePair {
  utteranceId: string
  from: string
  to: string
  /** `from`과 용어의 한글 발음의 자모 유사도 (0~1) */
  similarity: number
}

/** 발화 하나에 판정을 통과한 쌍을 모두 적용한 수정 제안. 원문은 사용자가 수락할 때만 바뀐다 */
export interface RefineSuggestion {
  id: string
  before: string
  after: string
  pairs: Pick<RefinePair, 'from' | 'to'>[]
}
