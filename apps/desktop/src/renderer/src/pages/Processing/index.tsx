import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import type { PrototypeDocumentDetail, PrototypeProcessingItem } from '@shared/prototype'
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

const STAGES = {
  recording: '녹음 중이에요',
  transcribing: '대화를 글로 옮기고 있어요',
  summarizing: '주제별 결정과 질문을 정리하고 있어요',
  publishing: '문서에 기록을 더하고 있어요',
  syncing: '서버에 원본을 보관하고 있어요',
  done: '정리가 끝났어요',
  error: '처리를 완료하지 못했어요'
}
export default function Processing() {
  const { meetingId } = useParams()
  return meetingId ? (
    <ProcessingContent key={meetingId} meetingId={meetingId} />
  ) : (
    <p>녹음을 찾을 수 없습니다.</p>
  )
}
function ProcessingContent({ meetingId }: { meetingId: string }) {
  const [job, setJob] = useState<PrototypeProcessingItem | null>(null)
  const [documents, setDocuments] = useState<PrototypeDocumentDetail[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isRetrying, setIsRetrying] = useState(false)
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  useEffect(() => {
    let isMounted = true
    const refresh = async () => {
      try {
        const jobs = await getProcessingApi()
        if (!isMounted) return
        const current = jobs.find((entry) => entry.meetingId === meetingId) ?? null
        setJob(current)
        if (
          current?.stage === 'done' ||
          current?.stage === 'syncing' ||
          current?.stage === 'publishing'
        ) {
          const catalog = await getDocumentsApi()
          const details = await Promise.all(catalog.map((doc) => getDocumentApi(doc.id)))
          if (isMounted)
            setDocuments(
              details.filter((doc): doc is PrototypeDocumentDetail =>
                Boolean(doc && doc.contributions.some((part) => part.recordingId === meetingId))
              )
            )
        }
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
  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <Link className={styles.back} to={PATHS.recordingHistory}>
          ‹ 녹음 이력
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
                return (
                  <li key={step} data-done={stageIndex > index}>
                    {stageIndex > index ? '✓' : index + 1}
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
          {job && (
            <p className={styles.saved}>
              {job.saved
                ? '녹음 파일·전사·AI 정리본·문서가 모두 서버에 저장됐어요.'
                : '로컬 원본을 보관하고 있어요. 서버 저장이 끝나면 여기에 표시됩니다.'}
            </p>
          )}
          <div className={styles.actions}>
            {(job?.status === 'failed' || job?.stage === 'error' || job?.stage === 'syncing') && (
              <button onClick={() => void retry()} disabled={isRetrying}>
                {isRetrying ? '다시 시작하는 중…' : '실패한 단계 다시 시도'}
              </button>
            )}
            {job && !['recording', 'transcribing'].includes(job.stage) && (
              <button onClick={() => setIsTranscriptOpen(!isTranscriptOpen)}>
                {isTranscriptOpen ? '원문 닫기' : '전사 원문 보기'}
              </button>
            )}
            <Link to={PATHS.settings}>AI·모델 설정</Link>
          </div>
        </section>
        {documents.length > 0 && (
          <section className={styles.results}>
            <h2>이번 회의가 더해진 문서</h2>
            {documents.map((doc) => (
              <Link key={doc.id} to={documentDetailPath(doc.id)}>
                {doc.title}
                <span>문서 보기 →</span>
              </Link>
            ))}
          </section>
        )}
        {job?.stage === 'done' && documents.length === 0 && (
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
