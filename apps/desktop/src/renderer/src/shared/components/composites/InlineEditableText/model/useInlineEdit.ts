import { useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'

interface UseInlineEditParams {
  value: string
  isMultiline: boolean
  onCommit: (next: string) => void
}

type EditorElement = HTMLInputElement | HTMLTextAreaElement

const useInlineEdit = ({ value, isMultiline, onCommit }: UseInlineEditParams) => {
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  // Escape로 취소한 직후 blur가 이어질 수 있어, 취소를 렌더와 무관한 플래그로 남긴다
  const isCancelledRef = useRef(false)
  // 편집 요소가 처음 포커스를 받을 때 한 번만 쓰고 비운다. 창 전환 뒤 재포커스에서 커서를 옮기지 않기 위해서다
  const pendingCaretRef = useRef<number | null>(null)

  /** caretOffset이 null이면 커서를 끝에 둔다 */
  const startEditing = (caretOffset: number | null) => {
    isCancelledRef.current = false
    pendingCaretRef.current = caretOffset ?? value.length
    setDraft(value)
    setIsEditing(true)
  }

  const handleFocus = (event: FocusEvent<EditorElement>) => {
    const caret = pendingCaretRef.current
    if (caret === null) return

    pendingCaretRef.current = null
    event.currentTarget.setSelectionRange(caret, caret)
  }

  const cancel = () => {
    isCancelledRef.current = true
    setIsEditing(false)
  }

  /** 빈 값은 저장하지 않고 원래 값으로 되돌린다 (references/architecture.md) */
  const commit = () => {
    setIsEditing(false)
    if (isCancelledRef.current) return

    const next = draft.trim()
    if (!next || next === value) return

    onCommit(next)
  }

  const handleKeyDown = (event: KeyboardEvent<EditorElement>) => {
    if (event.key === 'Escape') {
      cancel()
      return
    }

    if (event.key !== 'Enter') return
    // 여러 줄 편집에서 Enter는 줄바꿈이라 확정은 수식 키와 함께 눌렀을 때만 한다
    if (isMultiline && !event.metaKey && !event.ctrlKey) return

    event.preventDefault()
    commit()
  }

  return { isEditing, draft, setDraft, startEditing, commit, handleFocus, handleKeyDown }
}

export default useInlineEdit
