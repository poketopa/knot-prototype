import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import type { PrototypeDocumentDetail } from '@shared/prototype'
import { getDocumentApi, onPrototypeChanged, trackApi } from '@renderer/shared/api/prototype'
import { writeClipboardTextApi } from '@renderer/shared/api/clipboard'
import TranscriptPanel from '@renderer/modules/widgets/prototype/TranscriptPanel'
import { PATHS } from '@renderer/shared/routes/paths'
import styles from './index.module.css'

const formatDateTime = (value: string) =>
  new Date(value).toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })

export default function DocumentDetail() {
  const { documentId } = useParams()
  if (!documentId) return <p>문서를 찾을 수 없습니다.</p>
  return <DocumentContent key={documentId} documentId={documentId} />
}

function DocumentContent({ documentId }: { documentId: string }) {
  const [document, setDocument] = useState<PrototypeDocumentDetail | null>(null)
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isCopied, setIsCopied] = useState(false)
  const viewedVersion = useRef<number | null>(null)
  const initialized = useRef(false)
  useEffect(() => {
    let isMounted = true
    const refresh = async () => {
      try {
        const next = await getDocumentApi(documentId)
        if (!isMounted) return
        if (!next) throw new Error('문서를 찾을 수 없습니다.')
        setDocument(next)
        setError(null)
        if (viewedVersion.current !== next.version) {
          viewedVersion.current = next.version
          void trackApi({ eventType: 'document_viewed', documentId, version: next.version }).catch(
            () => {}
          )
        }
        if (!initialized.current) {
          initialized.current = true
          const preference = localStorage.getItem('knot-transcript-open')
          if (preference === 'yes' || (preference === null && window.innerWidth >= 1400)) {
            setRecordingId(next.contributions.at(-1)?.recordingId ?? null)
          }
        }
      } catch (caught) {
        if (isMounted) setError(caught instanceof Error ? caught.message : String(caught))
      }
    }
    void refresh()
    const unsubscribe = onPrototypeChanged(({ reason }) => {
      if (reason === 'documents') void refresh()
    })
    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [documentId])
  useEffect(() => {
    if (!isCopied) return
    const timer = setTimeout(() => setIsCopied(false), 3000)
    return () => clearTimeout(timer)
  }, [isCopied])
  const copy = async () => {
    if (!document) return
    try {
      await writeClipboardTextApi({ text: document.body })
      setIsCopied(true)
      void trackApi({ eventType: 'copied', documentId, version: document.version }).catch(() => {})
    } catch {
      setError('복사하지 못했어요. 다시 시도해 주세요.')
    }
  }
  const openTranscript = (id: string | null) => {
    setRecordingId(id)
    localStorage.setItem('knot-transcript-open', id ? 'yes' : 'no')
  }
  const latestContribution = document?.contributions.at(-1) ?? null
  const transcriptToggleLabel = recordingId ? '원문 닫기' : '원문 보기'
  return (
    <div className={`${styles.layout} ${recordingId ? styles.withTranscript : ''}`}>
      {document && (
        <button
          className={styles.transcriptToggle}
          type="button"
          title={transcriptToggleLabel}
          aria-label={transcriptToggleLabel}
          aria-expanded={Boolean(recordingId)}
          disabled={document.contributions.length === 0}
          onClick={() =>
            openTranscript(recordingId ? null : (latestContribution?.recordingId ?? null))
          }
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
            {recordingId ? (
              <path
                d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="1.8"
              />
            ) : (
              <path
                d="M7 5.5h7.5A2.5 2.5 0 0 1 17 8v8.5A2.5 2.5 0 0 1 14.5 19H7V5.5Zm0 0H5.8A1.8 1.8 0 0 0 4 7.3v8.9A2.8 2.8 0 0 0 6.8 19H7m3-9.5h4m-4 4h3"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.6"
              />
            )}
          </svg>
        </button>
      )}
      <article className={styles.document}>
        <Link className={styles.breadcrumb} to={PATHS.home}>
          문서 <span>›</span> {document?.title}
        </Link>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {!document ? (
          <p role="status">문서를 불러오고 있어요.</p>
        ) : (
          <>
            <div className={styles.toolbar}>
              <button onClick={() => void copy()}>{isCopied ? '복사됨' : '복사'}</button>
            </div>
            <h1>{document.title}</h1>
            <p className={styles.meta}>
              {latestContribution
                ? `${formatDate(latestContribution.startedAt)} 업데이트`
                : '아직 기록 없음'}
              <span>{document.contributions.length}회 기록</span>
            </p>
            {document.offline && (
              <p role="status" className={styles.historical}>
                서버에 연결할 수 없어 이 Mac에 보관한 버전 {document.version}을 보여드려요.
              </p>
            )}
            {document.contributions.map((entry) => (
              <section className={styles.contribution} key={entry.recordingId}>
                <div className={styles.date}>
                  <h2>{formatDateTime(entry.startedAt)}</h2>
                  <button onClick={() => openTranscript(entry.recordingId)}>이 회의 원문</button>
                </div>
                {entry.section.overview && (
                  <p className={styles.overview}>{entry.section.overview}</p>
                )}
                <h3>
                  <span className={styles.confirmedDot} />
                  확정된 결정
                </h3>
                {entry.section.decisions.length ? (
                  <ul>
                    {entry.section.decisions.map((item, i) => (
                      <li key={i}>{item.text}</li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.none}>이 회의에서 확정된 결정은 없어요.</p>
                )}
                <h3>
                  <span className={styles.openDot} />
                  미결정 사항
                </h3>
                {entry.section.unresolved.length ? (
                  <ul>
                    {entry.section.unresolved.map((item, i) => (
                      <li key={i}>{item.text}</li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.none}>이 회의에서 남긴 미결정 사항은 없어요.</p>
                )}
                <p className={styles.historical}>
                  이 회의 당시의 기록입니다. 이후 결정은 다음 회의 구역에 이어집니다.
                </p>
              </section>
            ))}
          </>
        )}
      </article>
      {recordingId && (
        <div className={styles.transcript}>
          <TranscriptPanel key={recordingId} recordingId={recordingId} />
        </div>
      )}
    </div>
  )
}
