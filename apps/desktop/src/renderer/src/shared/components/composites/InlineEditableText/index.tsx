import type { MouseEvent } from 'react'

import useInlineEdit from './model/useInlineEdit'
import getCaretOffset from './model/getCaretOffset'
import styles from './index.module.css'

interface InlineEditableTextProps {
  value: string
  onCommit: (next: string) => void
  /** 표시 상태 버튼과 편집 요소에 함께 붙는다. 스크린 리더가 무엇을 고치는지 알 수 있어야 한다 */
  ariaLabel: string
  isMultiline?: boolean
  className?: string
}

/**
 * 클릭(또는 키보드 진입)하면 편집 요소로 바뀌고 blur·Enter로 확정, Escape로 취소한다.
 * 회의 제목·발화 텍스트·화자 이름이 모두 이 컴포넌트를 쓴다.
 */
export default function InlineEditableText({
  value,
  onCommit,
  ariaLabel,
  isMultiline = false,
  className
}: InlineEditableTextProps) {
  const { isEditing, draft, setDraft, startEditing, commit, handleFocus, handleKeyDown } =
    useInlineEdit({
      value,
      isMultiline,
      onCommit
    })

  const handleDisplayClick = (event: MouseEvent<HTMLButtonElement>) => {
    startEditing(getCaretOffset(event))
  }

  const editorClassName = [styles.editor, className].filter(Boolean).join(' ')

  if (!isEditing) {
    return (
      <button
        type="button"
        className={[styles.display, className].filter(Boolean).join(' ')}
        aria-label={`${ariaLabel} 수정`}
        onClick={handleDisplayClick}
      >
        {value}
      </button>
    )
  }

  if (isMultiline) {
    return (
      <textarea
        // 편집 상태로 바뀌는 순간 커서를 넣어야 한다
        autoFocus
        className={editorClassName}
        aria-label={ariaLabel}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={handleFocus}
        onBlur={commit}
        onKeyDown={handleKeyDown}
      />
    )
  }

  return (
    <input
      // 편집 상태로 바뀌는 순간 커서를 넣어야 한다
      autoFocus
      className={editorClassName}
      aria-label={ariaLabel}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={handleFocus}
      onBlur={commit}
      onKeyDown={handleKeyDown}
    />
  )
}
