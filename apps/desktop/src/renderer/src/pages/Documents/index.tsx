import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { getDocumentsApi, onPrototypeChanged } from '@renderer/shared/api/prototype'
import DocumentTree, {
  type DocumentTreeItem
} from '@renderer/modules/widgets/prototype/DocumentTree'
import { PATHS } from '@renderer/shared/routes/paths'
import { useDocumentWorkspace } from './workspaceContext'
import styles from './index.module.css'

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })

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
          <p>도메인을 펼쳐 기록된 문서를 읽습니다.</p>
        </div>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {isLoading ? (
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
        <section className={styles.selection}>
          <h2>왼쪽에서 문서를 선택하세요</h2>
          <p>가장 최근 문서는 {formatDate(documents[0].updatedAt)}에 업데이트됐습니다.</p>
        </section>
      )}
    </main>
  )
}
