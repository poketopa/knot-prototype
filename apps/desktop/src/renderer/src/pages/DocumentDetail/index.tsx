import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
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
import { PATHS } from '@renderer/shared/routes/paths'
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

type DocumentFlowSection = {
  heading: string
  paragraphs: string[]
  items: string[]
}

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
  return minutes > 0 ? (seconds > 0 ? `${minutes}분 ${seconds}초` : `${minutes}분`) : `${seconds}초`
}

const splitSentences = (text: string) =>
  text
    .split(/(?<=[.!?。！？])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)

const appendFlowText = (
  map: Map<string, DocumentFlowSection>,
  heading: string,
  text: string,
  seen: Set<string>,
  asItem = false
) => {
  const normalizedHeading = heading.trim()
  const key = normalizedHeading.replace(/\s+/g, ' ').toLowerCase()
  const section = map.get(key) ?? { heading: normalizedHeading, paragraphs: [], items: [] }

  for (const sentence of splitSentences(text)) {
    const normalizedSentence = sentence.replace(/\s+/g, ' ').trim()
    const sentenceKey = `${key}:${normalizedSentence}`
    if (!normalizedSentence || seen.has(sentenceKey)) continue
    if (asItem) section.items.push(sentence)
    else section.paragraphs.push(sentence)
    seen.add(sentenceKey)
  }

  if (section.paragraphs.length || section.items.length) map.set(key, section)
}

const legacyFlowSections = (document: PrototypeDocumentDetailV2): DocumentFlowSection[] => {
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
          paragraphs: texts,
          items: []
        }
      ]
    : []
}

const documentFlowSections = (document: PrototypeDocumentDetailV2): DocumentFlowSection[] => {
  if (!document.summarySections?.length && !document.outline?.length)
    return legacyFlowSections(document)

  const sections = new Map<string, DocumentFlowSection>()
  const seen = new Set<string>()

  for (const section of document.summarySections ?? []) {
    appendFlowText(sections, section.heading, section.text, seen)
  }
  for (const section of document.outline ?? []) {
    for (const item of section.items) {
      appendFlowText(sections, section.heading, item.text, seen, true)
    }
  }

  return [...sections.values()]
}

const recordingIdFor = (document: PrototypeDocumentDetailV2) =>
  document.recordingId ?? document.contributions.at(-1)?.recordingId ?? null

const recordingStartedAtFor = (document: PrototypeDocumentDetailV2) =>
  document.recordingStartedAt ?? document.contributions.at(-1)?.startedAt

export default function DocumentDetail({ embedded = false }: { embedded?: boolean }) {
  const { documentId } = useParams()
  if (!documentId) return <p>문서를 찾을 수 없습니다.</p>
  return <DocumentContent key={documentId} documentId={documentId} embedded={embedded} />
}

function DocumentContent({ documentId, embedded }: { documentId: string; embedded: boolean }) {
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
          embedded ? Promise.resolve([]) : getDocumentsApi()
        ])
        if (!isMounted) return
        if (!next) throw new Error('문서를 찾을 수 없습니다.')
        const typed = next as PrototypeDocumentDetailV2
        setDocument(typed)
        if (!embedded)
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
          if (preference === 'yes') {
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
  }, [documentId, embedded])

  const openTranscript = (id: string | null) => {
    setRecordingId(id)
    localStorage.setItem('knot-transcript-open', id ? 'yes' : 'no')
  }

  const transcriptId = document ? recordingIdFor(document) : null
  const transcriptToggleLabel = recordingId ? '원문 닫기' : '원문 보기'
  const flowSections = document ? documentFlowSections(document) : []
  const startedAt = document ? recordingStartedAtFor(document) : undefined
  const duration = document ? formatDuration(document.durationSec) : null
  const transcriptArtifactId = document?.transcriptArtifactId

  return (
    <div className={`${styles.layout} ${recordingId ? styles.withTranscript : ''}`}>
      {!embedded && <DocumentTree documents={catalog} activeDocumentId={documentId} />}
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
            <nav className={styles.breadcrumb} aria-label="문서 경로">
              <Link to={PATHS.home}>문서</Link>
              <span aria-hidden="true">&gt;</span>
              <span>{document.title}</span>
            </nav>
            <h1>{document.title}</h1>
            <p className={styles.meta}>
              <time dateTime={startedAt}>{formatDate(startedAt)}</time>
              {duration && <span>{duration}</span>}
            </p>
            {document.offline && (
              <p role="status" className={styles.historical}>
                서버에 연결할 수 없어 이 Mac에 보관한 버전 {document.version}을 보여드려요.
              </p>
            )}
            <section className={styles.flow} aria-label="문서 내용">
              {flowSections.length === 0 ? (
                <p className={styles.none}>아직 표시할 요약이 없습니다.</p>
              ) : (
                flowSections.map((section, index) => (
                  <section className={styles.flowSection} key={`${section.heading}-${index}`}>
                    <h2>{section.heading}</h2>
                    {section.paragraphs.map((paragraph, paragraphIndex) => (
                      <p key={`${paragraph}-${paragraphIndex}`}>{paragraph}</p>
                    ))}
                    {section.items.length > 0 && (
                      <ul>
                        {section.items.map((item, itemIndex) => (
                          <li key={`${item}-${itemIndex}`}>{item}</li>
                        ))}
                      </ul>
                    )}
                  </section>
                ))
              )}
            </section>
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
