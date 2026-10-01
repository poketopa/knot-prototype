import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { prototypeBroadDocumentDomain } from '@shared/prototype'
import { getDocumentsApi, onPrototypeChanged } from '@renderer/shared/api/prototype'
import DocumentTree, {
  type DocumentTreeItem
} from '@renderer/modules/widgets/prototype/DocumentTree'
import { PATHS } from '@renderer/shared/routes/paths'
import { useDocumentWorkspace } from './workspaceContext'
import styles from './index.module.css'

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })

const formatDuration = (durationSec?: number) => {
  if (typeof durationSec !== 'number' || !Number.isFinite(durationSec) || durationSec <= 0)
    return null
  const totalSeconds = Math.round(durationSec)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}시간 ${minutes}분 ${seconds}초`
  if (minutes > 0) return seconds ? `${minutes}분 ${seconds}초` : `${minutes}분`
  return `${seconds}초`
}

const timestampOf = (document: DocumentTreeItem) =>
  new Date(document.recordingStartedAt ?? document.updatedAt).getTime()

const firstSentence = (value?: string) => {
  const normalized = value?.trim().replace(/\s+/g, ' ')
  if (!normalized) return '회의에서 나온 핵심 내용을 문서로 정리했어요.'
  const match = normalized.match(/^.+?[.!?。！？]|^.+?(?:요|다)(?:\s|$)/)
  return (match?.[0] ?? normalized).trim()
}

const groupedDocuments = (documents: DocumentTreeItem[]) => {
  const groups = documents.reduce<Map<string, DocumentTreeItem[]>>((map, document) => {
    const domain = prototypeBroadDocumentDomain(document) || '미분류'
    map.set(domain, [...(map.get(domain) ?? []), document])
    return map
  }, new Map())

  return [...groups.entries()]
    .map(([domain, items]) => ({
      domain,
      items: [...items].sort((a, b) => timestampOf(b) - timestampOf(a)),
      latestAt: Math.max(...items.map(timestampOf))
    }))
    .sort((a, b) => b.latestAt - a.latestAt || a.domain.localeCompare(b.domain, 'ko-KR'))
}

export default function Documents() {
  const workspace = useDocumentWorkspace()
  if (workspace) return <DocumentsContent {...workspace} />
  return <StandaloneDocuments />
}

function StandaloneDocuments() {
  const [documents, setDocuments] = useState<DocumentTreeItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  useEffect(() => {
    let isMounted = true
    const refresh = async () => {
      try {
        const docs = await getDocumentsApi()
        if (isMounted) {
          setDocuments(docs as DocumentTreeItem[])
          setError(null)
        }
      } catch (caught) {
        if (isMounted) setError(caught instanceof Error ? caught.message : String(caught))
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
  }, [])
  return (
    <div className={styles.layout}>
      <DocumentTree documents={documents} />
      <DocumentsContent documents={documents} error={error} isLoading={isLoading} />
    </div>
  )
}

export function DocumentsContent({
  documents,
  error,
  isLoading
}: {
  documents: DocumentTreeItem[]
  error: string | null
  isLoading: boolean
}) {
  return (
    <main className={styles.page}>
      <div className={styles.heading}>
        <div>
          <h1>문서</h1>
          <p>녹음하고 정리한 내용을 폴더별로 모아둬요.</p>
        </div>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {isLoading && documents.length === 0 ? (
        <p role="status" className={styles.empty}>
          문서를 불러오고 있어요.
        </p>
      ) : documents.length === 0 ? (
        <section className={styles.empty}>
          <h2>아직 기록된 문서가 없습니다</h2>
          <p>
            녹음을 끝내면 전사와 AI 정리가 이어지고,
            <br />
            생성된 문서가 도메인별로 정리됩니다.
          </p>
          <Link to={PATHS.record}>새 녹음 시작</Link>
        </section>
      ) : (
        <section className={styles.groups} aria-label="문서 목록">
          {groupedDocuments(documents).map((group) => (
            <article className={styles.groupBlock} key={group.domain}>
              <header className={styles.groupHeader}>
                <h2>{group.domain}</h2>
                <span>{group.items.length}</span>
              </header>
              <div className={styles.groupCard}>
                {group.items.map((document) => {
                  const duration = formatDuration(document.durationSec)
                  return (
                    <Link
                      className={styles.documentRow}
                      key={document.id}
                      to={`/documents/${document.id}`}
                    >
                      <span>
                        <strong className={styles.rowTitle}>{document.title}</strong>
                        <span className={styles.rowOverview}>
                          {firstSentence(document.overview)}
                        </span>
                      </span>
                      <span className={styles.rowMeta}>
                        {formatDate(document.recordingStartedAt ?? document.updatedAt)}
                        {duration && <span className={styles.durationBadge}>{duration}</span>}
                      </span>
                      <span className={styles.rowArrow} aria-hidden="true">
                        ›
                      </span>
                    </Link>
                  )
                })}
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  )
}
