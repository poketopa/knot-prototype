import { createContext, useContext } from 'react'
import type { DocumentTreeItem } from '@renderer/modules/widgets/prototype/DocumentTree'

export type DocumentWorkspaceContextValue = {
  documents: DocumentTreeItem[]
  error: string | null
  isLoading: boolean
}

export const DocumentWorkspaceContext = createContext<DocumentWorkspaceContextValue | null>(null)

export const useDocumentWorkspace = () => useContext(DocumentWorkspaceContext)
