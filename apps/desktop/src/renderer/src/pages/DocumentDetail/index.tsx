import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router'
import type { PrototypeDocumentDetail, PrototypeDocumentListItem } from '@shared/prototype'
import {
  getDocumentApi,
  getDocumentsApi,
  onPrototypeChanged,
  trackApi
} from '@renderer/shared/api/prototype'
import TranscriptPanel from '@renderer/modules/widgets/prototype/TranscriptPanel'
import DocumentTree, {
  type DocumentTreeItem
} from '@renderer/modules/widgets/prototype/DocumentTree'
import styles from './index.module.css'

type DocumentSummarySection = {
  heading: string
  text: string
  sourceUtteranceIds?: string[]
}

type DocumentOutlineItem = {
  text: string
  sourceUtteranceIds?: string[]
}

type DocumentOutlineSection = {
  heading: string
  items: DocumentOutlineItem[]
}

type PrototypeDocumentDetailV2 = PrototypeDocumentDetail & {
  domain?: string
  recordingId?: string
  recordingStartedAt?: string
  transcriptArtifactId?: string
  durationSec?: number
  summarySections?: DocumentSummarySection[]
  outline?: DocumentOutlineSection[]
}

const formatDateTime = (value?: string) =>
  value
    ? new Date(value).toLocaleString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    : '날짜 없음'

const formatDate = (value?: string) =>
  value
    ? new Date(value).toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    : '날짜 없음'

const formatDuration = (sec?: number) => {
  if (!sec || sec < 1) return null
  const minutes = Math.floor(sec / 60)
  const seconds = sec % 60
  return minutes > 0 ? `${minutes}분 ${seconds}초` : `${seconds}초`
}

const fallbackSummarySections = (document: PrototypeDocumentDetailV2): DocumentSummarySection[] => {
  if (document.summarySections?.length) return document.summarySections
  const latest = document.contributions.at(-1)
  if (!latest) return []
  const texts = [
    latest.section.overview,
    ...latest.section.decisions.map((item) => item.text),
    ...latest.section.unresolved.map((item) => item.text)
  ].filter(Boolean)
  return texts.length
    ? [
        {
          heading: formatDate(latest.startedAt),
          text: texts.join('\n')
        }
      ]
    : []
}

const fallbackOutline = (document: PrototypeDocumentDetailV2): DocumentOutlineSection[] => {
  if (document.outline?.length) return document.outline
  return document.contributions
    .map((entry) => {
      const items = [
        ...entry.section.decisions.map((item) => item.text),
        ...entry.section.unresolved.map((item) => item.text)
      ].filter(Boolean)
      return {
        heading: formatDate(entry.startedAt),
        items: items.map((text) => ({ text }))
      }
    })
    .filter((section) => section.items.length > 0)
}

const recordingIdFor = (document: PrototypeDocumentDetailV2) =>
  document.recordingId ?? document.contributions.at(-1)?.recordingId ?? null

const recordingStartedAtFor = (document: PrototypeDocumentDetailV2) =>
  document.recordingStartedAt ?? document.contributions.at(-1)?.startedAt

export default function DocumentDetail() {
  const { documentId } = useParams()
  if (!documentId) return <p>문서를 찾을 수 없습니다.</p>
  return <DocumentContent key={documentId} documentId={documentId} />
}

function DocumentContent({ documentId }: { documentId: string }) {
  const [catalog, setCatalog] = useState<DocumentTreeItem[]>([])
  const [document, setDocument] = useState<PrototypeDocumentDetailV2 | null>(null)
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const viewedVersion = useRef<number | null>(null)
  const initialized = useRef(false)
  useEffect(() => {
    let isMounted = true
    const refresh = async () => {
      try {
        const [next, nextCatalog] = await Promise.all([
          getDocumentApi(documentId),
          getDocumentsApi()
        ])
        if (!isMounted) return
        if (!next) throw new Error('문서를 찾을 수 없습니다.')
        const typed = next as PrototypeDocumentDetailV2
        setDocument(typed)
        setCatalog(nextCatalog as Array<PrototypeDocumentListItem & DocumentTreeItem>)
        setError(null)
        if (viewedVersion.current !== typed.version) {
          viewedVersion.current = typed.version
          void trackApi({ eventType: 'document_viewed', documentId, version: typed.version }).catch(
            () => {}
          )
        }
        if (!initialized.current) {
          initialized.current = true
          const preference = localStorage.getItem('knot-transcript-open')
          if (preference === 'yes' || (preference === null && window.innerWidth >= 1400)) {
            setRecordingId(recordingIdFor(typed))
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

  const openTranscript = (id: string | null) => {
    setRecordingId(id)
    localStorage.setItem('knot-transcript-open', id ? 'yes' : 'no')
  }

  const transcriptId = document ? recordingIdFor(document) : null
  const transcriptToggleLabel = recordingId ? '원문 닫기' : '원문 보기'
  const summarySections = document ? fallbackSummarySections(document) : []
  const outline = document ? fallbackOutline(document) : []
  const startedAt = document ? recordingStartedAtFor(document) : undefined
  const duration = document ? formatDuration(document.durationSec) : null
  const transcriptArtifactId = document?.transcriptArtifactId

  return (
    <div className={`${styles.layout} ${recordingId ? styles.withTranscript : ''}`}>
      <DocumentTree documents={catalog} activeDocumentId={documentId} />
      {document && (
        <button
          className={styles.transcriptToggle}
          type="button"
          title={transcriptToggleLabel}
          aria-label={transcriptToggleLabel}
          aria-expanded={Boolean(recordingId)}
          disabled={!transcriptId}
          onClick={() => openTranscript(recordingId ? null : transcriptId)}
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
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {!document ? (
          <p role="status">문서를 불러오고 있어요.</p>
        ) : (
          <>
            <p className={styles.domain}>{document.domain ?? '분류 없음'}</p>
            <h1>{document.title}</h1>
            <p className={styles.meta}>
              <time dateTime={startedAt}>{formatDateTime(startedAt)}</time>
              {duration && <span>{duration}</span>}
            </p>
            {document.offline && (
              <p role="status" className={styles.historical}>
                서버에 연결할 수 없어 이 Mac에 보관한 버전 {document.version}을 보여드려요.
              </p>
            )}
            <section className={styles.summary} aria-label="문서 요약">
              {summarySections.length === 0 ? (
                <p className={styles.none}>아직 표시할 요약이 없습니다.</p>
              ) : (
                summarySections.map((section, index) => (
                  <section className={styles.summarySection} key={`${section.heading}-${index}`}>
                    <h2>{section.heading}</h2>
                    <p>{section.text}</p>
                  </section>
                ))
              )}
            </section>
            {outline.length > 0 && (
              <section className={styles.outline} aria-label="논의 상세">
                <h2 className={styles.outlineTitle}>논의 상세</h2>
                {outline.map((section, sectionIndex) => (
                  <section
                    className={styles.outlineSection}
                    key={`${section.heading}-${sectionIndex}`}
                  >
                    <h3>{section.heading}</h3>
                    <ul>
                      {section.items.map((item, itemIndex) => (
                        <li key={`${item.text}-${itemIndex}`}>{item.text}</li>
                      ))}
                    </ul>
                  </section>
                ))}
              </section>
            )}
            {transcriptId && (
              <button
                className={styles.inlineTranscript}
                onClick={() => openTranscript(transcriptId)}
              >
                이 녹음 원문 보기
              </button>
            )}
          </>
        )}
      </article>
      {recordingId && (
        <div className={styles.transcript}>
          <TranscriptPanel
            key={`${recordingId}:${transcriptArtifactId ?? ''}`}
            recordingId={recordingId}
            artifactId={transcriptArtifactId}
          />
        </div>
      )}
    </div>
  )
}
