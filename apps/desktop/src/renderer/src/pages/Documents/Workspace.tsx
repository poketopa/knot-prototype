import { useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useParams } from 'react-router'
import { getDocumentsApi, onPrototypeChanged } from '@renderer/shared/api/prototype'
import DocumentTree, {
  type DocumentTreeItem
} from '@renderer/modules/widgets/prototype/DocumentTree'
import { DocumentWorkspaceContext } from './workspaceContext'
import styles from './index.module.css'

export default function DocumentWorkspace() {
  const { documentId } = useParams()
  const [documents, setDocuments] = useState<DocumentTreeItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const requestId = useRef(0)

  useEffect(() => {
    let isMounted = true
    const refresh = async ({ clear = false }: { clear?: boolean } = {}) => {
      const currentRequest = requestId.current + 1
      requestId.current = currentRequest
      if (clear) {
        setDocuments([])
        setError(null)
      }
      setIsLoading(true)
      try {
        const docs = await getDocumentsApi()
        if (isMounted && requestId.current === currentRequest) {
          setDocuments(docs as DocumentTreeItem[])
          setError(null)
        }
      } catch (caught) {
        if (isMounted && requestId.current === currentRequest) {
          setError(caught instanceof Error ? caught.message : String(caught))
        }
      } finally {
        if (isMounted && requestId.current === currentRequest) setIsLoading(false)
      }
    }
    void refresh()
    const unsubscribe = onPrototypeChanged(({ reason }) => {
      if (reason === 'auth') {
        void refresh({ clear: true })
        return
      }
      if (reason !== 'event') void refresh()
    })
    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [])

  const value = useMemo(() => ({ documents, error, isLoading }), [documents, error, isLoading])

  return (
    <DocumentWorkspaceContext.Provider value={value}>
      <div className={styles.layout}>
        <DocumentTree documents={documents} activeDocumentId={documentId} />
        <Outlet />
      </div>
    </DocumentWorkspaceContext.Provider>
  )
}
