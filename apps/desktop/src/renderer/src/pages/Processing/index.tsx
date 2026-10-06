import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type {
  PrototypeComparison,
  PrototypeComparisonCandidate,
  PrototypeDocumentDetail,
  PrototypeDocumentListItem,
  PrototypeProcessingItem
} from '@shared/prototype'
import type {
  SummaryMeetingType,
  SummarySelectionReason,
  SummaryVariant
} from '@meeting-stt/prototype-contracts/types'
import {
  chooseComparisonApi,
  getComparisonApi,
  getDocumentApi,
  getDocumentsApi,
  getProcessingApi,
  onPrototypeChanged,
  retryProcessingApi
} from '@renderer/shared/api/prototype'
import TranscriptPanel from '@renderer/modules/widgets/prototype/TranscriptPanel'
import { documentDetailPath, PATHS } from '@renderer/shared/routes/paths'
import styles from './index.module.css'

type ProcessingItemV2 = PrototypeProcessingItem & {
  startedAt?: string
}

type DocumentListItemV2 = PrototypeDocumentListItem & {
  recordingId?: string
  recordingStartedAt?: string
}

type DocumentDetailV2 = PrototypeDocumentDetail & {
  recordingId?: string
  recordingStartedAt?: string
}

const STAGES = {
  recording: '녹음 중이에요',
  transcribing: '대화를 글로 옮기고 있어요',
  summarizing: '주제별 핵심과 논의 상세를 정리하고 있어요',
  choosing: '더 마음에 드는 정리를 골라 주세요',
  publishing: '주제별 문서를 만들고 있어요',
  syncing: '서버에 원본을 보관하고 있어요',
  done: '정리가 끝났어요',
  error: '처리를 완료하지 못했어요'
}

const BUSY_STAGES = new Set<PrototypeProcessingItem['stage']>([
  'recording',
  'transcribing',
  'summarizing'
])

const REASON_OPTIONS: Array<{ value: SummarySelectionReason; label: string }> = [
  { value: 'decisions_actions', label: '결정·할 일이 더 잘 보여' },
  { value: 'accuracy', label: '내용이 더 정확해' },
  { value: 'readability', label: '더 읽기 편해' },
  { value: 'other', label: '기타' }
]

const MEETING_TYPE_OPTIONS: Array<{ value: SummaryMeetingType; label: string }> = [
  { value: 'multi_agenda', label: '여러 안건 회의' },
  { value: 'interview_feedback', label: '인터뷰·피드백' },
  { value: 'introduction_sharing', label: '소개·공유' }
]

const orderedCandidates = (comparison: PrototypeComparison) => {
  const first = comparison.firstVariant
  const second: SummaryVariant = first === 'A' ? 'B' : 'A'

  return [first, second]
    .map((variant) => comparison.candidates.find((candidate) => candidate.variant === variant))
    .filter((candidate): candidate is PrototypeComparisonCandidate => Boolean(candidate))
}

export default function Processing() {
  const { meetingId } = useParams()
  const navigate = useNavigate()
  return meetingId ? (
    <ProcessingContent
      key={meetingId}
      meetingId={meetingId}
      onSavedComplete={() => navigate(PATHS.record, { replace: true })}
    />
  ) : (
    <p>녹음을 찾을 수 없습니다.</p>
  )
}
export function ProcessingContent({
  meetingId,
  onNewRecording,
  onSavedComplete
}: {
  meetingId: string
  onNewRecording?: () => void
  onSavedComplete?: () => void
}) {
  const [job, setJob] = useState<ProcessingItemV2 | null>(null)
  const [comparison, setComparison] = useState<PrototypeComparison | null>(null)
  const [documents, setDocuments] = useState<DocumentDetailV2[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isRetrying, setIsRetrying] = useState(false)
  const [isChoosing, setIsChoosing] = useState(false)
  const [selectedVariant, setSelectedVariant] = useState<SummaryVariant | null>(null)
  const [reason, setReason] = useState<SummarySelectionReason | null>(null)
  const [meetingType, setMeetingType] = useState<SummaryMeetingType | null>(null)
  const [otherReason, setOtherReason] = useState('')
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  useEffect(() => {
    let isMounted = true
    const refresh = async () => {
      setIsLoading(true)
      try {
        const jobs = (await getProcessingApi()) as ProcessingItemV2[]
        if (!isMounted) return
        const current = jobs.find((entry) => entry.meetingId === meetingId) ?? null
        setJob(current)
        if (current?.stage === 'choosing') {
          const nextComparison = await getComparisonApi(meetingId)
          if (!isMounted) return
          setComparison(nextComparison)
        } else {
          setComparison(null)
        }
        if (current?.stage === 'done' && current.saved && onSavedComplete) {
          onSavedComplete()
          return
        }
        if (
          current?.stage === 'done' ||
          current?.stage === 'syncing' ||
          current?.stage === 'publishing' ||
          current?.stage === 'error'
        ) {
          const catalog = (await getDocumentsApi()) as DocumentListItemV2[]
          const matchingCatalog = catalog.filter((doc) => doc.recordingId === meetingId)
          const candidates = matchingCatalog.length > 0 ? matchingCatalog : catalog
          const details = await Promise.all(candidates.map((doc) => getDocumentApi(doc.id)))
          if (isMounted)
            setDocuments(
              details.filter((doc): doc is DocumentDetailV2 =>
                Boolean(
                  doc &&
                  ((doc as DocumentDetailV2).recordingId === meetingId ||
                    doc.contributions.some((part) => part.recordingId === meetingId))
                )
              )
            )
        }
        if (isMounted) setError(null)
      } catch (caught) {
        if (isMounted) setError(String(caught))
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }
    void refresh()
    const unsubscribe = onPrototypeChanged(({ reason }) => {
      if (reason !== 'event') void refresh()
    })
    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [meetingId, onSavedComplete])
  const retry = async () => {
    setIsRetrying(true)
    setError(null)
    try {
      await retryProcessingApi(meetingId)
    } catch (caught) {
      setError(String(caught))
    } finally {
      setIsRetrying(false)
    }
  }
  const canStartNewRecording = Boolean(job && !BUSY_STAGES.has(job.stage))
  const newRecording = () => {
    if (onNewRecording) {
      onNewRecording()
      return
    }
    window.location.hash = PATHS.record
  }
  return (
    <div className={styles.page}>
      <div className={`${styles.content} ${job?.stage === 'choosing' ? styles.comparing : ''}`}>
        <Link className={styles.back} to={PATHS.record}>
          ‹ 녹음
        </Link>
        <section className={styles.card}>
          <p className={styles.eyebrow}>녹음 → 전사 → AI 정리 → 보관</p>
          <h1>
            {job
              ? STAGES[job.stage]
              : isLoading
                ? '처리 상태를 확인하고 있어요'
                : '처리 기록을 찾지 못했어요'}
          </h1>
          <p>{job?.title}</p>
          {job && (
            <ol className={styles.steps} aria-label="처리 단계">
              {['녹음', '전사', 'AI 정리', '서버 보관'].map((step, index) => {
                const stageIndex = {
                  recording: 0,
                  transcribing: 1,
                  summarizing: 2,
                  publishing: 3,
                  choosing: 3,
                  syncing: 3,
                  done: 4,
                  error: -1
                }[job.stage]
                const stages = ['recording', 'transcribing', 'summarizing', 'syncing'] as const
                const completed = job.completedStages
                  ? job.completedStages.includes(stages[index])
                  : stageIndex > index
                return (
                  <li key={step} data-done={completed}>
                    {completed ? '✓' : index + 1}
                    <span>{step}</span>
                  </li>
                )
              })}
            </ol>
          )}
          {(error || job?.error) && (
            <p role="alert" className={styles.error}>
              {error || job?.error}
            </p>
          )}
          {job?.syncError && (
            <p role="alert" className={styles.error}>
              서버 보관: {job.syncError}
            </p>
          )}
          {job?.recordingWarning && (
            <p role="alert" className={styles.error}>
              {job.recordingWarning}
            </p>
          )}
          {job && (
            <p className={styles.saved}>
              {job.stage === 'choosing'
                ? comparison?.selection
                  ? '선택한 정리를 문서로 발행하고 있어요.'
                  : '두 정리본은 모두 이 Mac에 보관됩니다. 선택한 정리만 문서로 발행됩니다.'
                : job.stage === 'syncing' && job.syncError
                  ? '전사와 AI 정리본은 이 Mac에 남아 있습니다. 서버 보관만 다시 시도할 수 있어요.'
                  : job.saved
                    ? '녹음 파일·전사·AI 정리본·문서가 저장됐어요.'
                    : '전사와 AI 정리본을 이 Mac에 보관하고 있어요.'}
            </p>
          )}
          <div className={styles.actions}>
            {(job?.canRetry ??
              (job?.status === 'failed' || job?.stage === 'error' || job?.stage === 'syncing')) && (
              <button onClick={() => void retry()} disabled={isRetrying}>
                {isRetrying ? '다시 시작하는 중…' : '실패한 단계 다시 시도'}
              </button>
            )}
            {job && (job.hasTranscript ?? !['recording', 'transcribing'].includes(job.stage)) && (
              <button onClick={() => setIsTranscriptOpen(!isTranscriptOpen)}>
                {isTranscriptOpen ? '원문 닫기' : '전사 원문 보기'}
              </button>
            )}
            {canStartNewRecording && <button onClick={newRecording}>새 녹음</button>}
            <Link to={PATHS.settings}>AI·모델 설정</Link>
          </div>
        </section>
        {job?.stage === 'choosing' && comparison && (
          <SummaryComparison
            comparison={comparison}
            selectedVariant={selectedVariant}
            reason={reason}
            meetingType={meetingType}
            otherReason={otherReason}
            isSubmitting={isChoosing}
            onSelectedVariantChange={setSelectedVariant}
            onReasonChange={setReason}
            onMeetingTypeChange={setMeetingType}
            onOtherReasonChange={setOtherReason}
            onSubmit={async () => {
              if (!selectedVariant || !reason || !meetingType) return
              setIsChoosing(true)
              setError(null)
              try {
                await chooseComparisonApi({
                  recordingId: meetingId,
                  selectedVariant,
                  reason,
                  meetingType,
                  ...(otherReason.trim() ? { otherReason: otherReason.trim() } : {})
                })
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : String(caught))
              } finally {
                setIsChoosing(false)
              }
            }}
          />
        )}
        {job?.stage === 'choosing' && !isLoading && !comparison && (
          <p className={styles.saved}>비교할 정리를 불러오지 못했습니다.</p>
        )}
        {documents.length > 0 && (
          <section className={styles.results}>
            <h2>이번 회의에서 생성된 문서</h2>
            {documents.map((doc) => (
              <Link key={doc.id} to={documentDetailPath(doc.id)}>
                {doc.title}
                <span>문서 보기 →</span>
              </Link>
            ))}
          </section>
        )}
        {isLoading && job?.stage === 'done' && documents.length === 0 && (
          <p className={styles.saved}>생성된 문서를 불러오고 있어요.</p>
        )}
        {!isLoading && !error && job?.stage === 'done' && documents.length === 0 && (
          <p className={styles.saved}>
            추가할 주제별 논의가 없습니다. 원본과 AI 결과는 계속 보관합니다.
          </p>
        )}
      </div>
      {isTranscriptOpen && (
        <div className={styles.transcript}>
          <TranscriptPanel
            key={meetingId}
            recordingId={meetingId}
            onClose={() => setIsTranscriptOpen(false)}
          />
        </div>
      )}
    </div>
  )
}

function SummaryComparison({
  comparison,
  selectedVariant,
  reason,
  meetingType,
  otherReason,
  isSubmitting,
  onSelectedVariantChange,
  onReasonChange,
  onMeetingTypeChange,
  onOtherReasonChange,
  onSubmit
}: {
  comparison: PrototypeComparison
  selectedVariant: SummaryVariant | null
  reason: SummarySelectionReason | null
  meetingType: SummaryMeetingType | null
  otherReason: string
  isSubmitting: boolean
  onSelectedVariantChange: (variant: SummaryVariant) => void
  onReasonChange: (reason: SummarySelectionReason) => void
  onMeetingTypeChange: (meetingType: SummaryMeetingType) => void
  onOtherReasonChange: (reason: string) => void
  onSubmit: () => Promise<void>
}) {
  const candidates = orderedCandidates(comparison)
  const canSubmit = Boolean(selectedVariant && reason && meetingType) && !isSubmitting

  if (comparison.selection) {
    const chosenIndex = candidates.findIndex(
      (candidate) => candidate.variant === comparison.selection?.selectedVariant
    )
    return (
      <section className={styles.choicePanel} aria-live="polite">
        <h2>선택을 저장했어요</h2>
        <p>{chosenIndex >= 0 ? `정리 ${chosenIndex + 1}` : '선택한 정리'}를 문서로 발행합니다.</p>
      </section>
    )
  }

  return (
    <section className={styles.comparison} aria-label="정리 비교">
      <div className={styles.comparisonGrid}>
        {candidates.map((candidate, index) => (
          <article key={candidate.variant} className={styles.summaryCandidate}>
            <label className={styles.candidateHeader}>
              <input
                type="radio"
                name="summary-candidate"
                disabled={isSubmitting}
                checked={selectedVariant === candidate.variant}
                onChange={() => onSelectedVariantChange(candidate.variant)}
              />
              <span>정리 {index + 1}</span>
            </label>
            <TopicBundle candidate={candidate} />
          </article>
        ))}
      </div>
      <div className={styles.choicePanel}>
        <fieldset>
          <legend>고른 이유</legend>
          {REASON_OPTIONS.map((option) => (
            <label key={option.value}>
              <input
                type="radio"
                name="summary-reason"
                disabled={isSubmitting}
                checked={reason === option.value}
                onChange={() => onReasonChange(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
          {reason === 'other' && (
            <textarea
              value={otherReason}
              maxLength={500}
              disabled={isSubmitting}
              placeholder="이유를 적어 주세요"
              onChange={(event) => onOtherReasonChange(event.target.value)}
            />
          )}
        </fieldset>
        <fieldset>
          <legend>회의 종류</legend>
          {MEETING_TYPE_OPTIONS.map((option) => (
            <label key={option.value}>
              <input
                type="radio"
                name="summary-meeting-type"
                disabled={isSubmitting}
                checked={meetingType === option.value}
                onChange={() => onMeetingTypeChange(option.value)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </fieldset>
        <button type="button" disabled={!canSubmit} onClick={() => void onSubmit()}>
          {isSubmitting ? '발행 중…' : '선택한 정리 발행'}
        </button>
      </div>
    </section>
  )
}

function TopicBundle({ candidate }: { candidate: PrototypeComparisonCandidate }) {
  if (candidate.topics.length === 0) {
    return <p className={styles.emptyCandidate}>표시할 주제별 정리가 없습니다.</p>
  }

  return (
    <div className={styles.topicList}>
      {candidate.topics.map((topic) => (
        <section key={`${candidate.variant}-${topic.documentId}-${topic.title}`}>
          <h3>{topic.title}</h3>
          {topic.summarySections.map((section) => (
            <div key={`${topic.documentId}-${section.heading}-${section.text}`}>
              <h4>{section.heading}</h4>
              <p>{section.text}</p>
            </div>
          ))}
          {topic.outline.map((section) => (
            <div key={`${topic.documentId}-${section.heading}`}>
              <h4>{section.heading}</h4>
              <ul>
                {section.items.map((item) => (
                  <li key={`${section.heading}-${item.text}`}>{item.text}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
