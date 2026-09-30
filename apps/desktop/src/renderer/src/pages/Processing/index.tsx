import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import type {
  PrototypeDocumentDetail,
  PrototypeDocumentListItem,
  PrototypeProcessingItem
} from '@shared/prototype'
import {
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

export default function Processing() {
  const { meetingId } = useParams()
  return meetingId ? (
    <ProcessingContent key={meetingId} meetingId={meetingId} />
  ) : (
    <p>녹음을 찾을 수 없습니다.</p>
  )
}
export function ProcessingContent({
  meetingId,
  onNewRecording
}: {
  meetingId: string
  onNewRecording?: () => void
}) {
  const [job, setJob] = useState<ProcessingItemV2 | null>(null)
  const [documents, setDocuments] = useState<DocumentDetailV2[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isRetrying, setIsRetrying] = useState(false)
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
  }, [meetingId])
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
    window.location.hash = `${PATHS.record}?new=1`
  }
  return (
    <div className={styles.page}>
      <div className={styles.content}>
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
              {job.stage === 'syncing' && job.syncError
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
