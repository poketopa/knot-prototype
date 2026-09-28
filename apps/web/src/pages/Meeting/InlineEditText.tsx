import { useState, type KeyboardEvent } from 'react'

import styles from './InlineEditText.module.css'

interface InlineEditTextProps {
  value: string
  /** 비어 있지 않은 새 값으로만 불린다 */
  onCommit: (next: string) => void
  /** 편집 버튼과 입력의 접근성 이름 */
  label: string
  className?: string
}

/** 누르면 입력으로 바뀌고 blur·Enter로 확정, Esc로 취소한다. 제목·화자 이름에 쓴다 */
export default function InlineEditText({ value, onCommit, label, className }: InlineEditTextProps) {
  const [draft, setDraft] = useState<string | null>(null)

  const commit = () => {
    if (draft === null) return

    const trimmed = draft.trim()
    if (trimmed !== '' && trimmed !== value) onCommit(trimmed)
    setDraft(null)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') commit()
    if (event.key === 'Escape') setDraft(null)
  }

  if (draft !== null) {
    return (
      <input
        className={[styles.input, className].filter(Boolean).join(' ')}
        aria-label={label}
        value={draft}
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
      />
    )
  }

  return (
    <button
      type="button"
      className={[styles.button, className].filter(Boolean).join(' ')}
      aria-label={`${label} 편집`}
      onClick={() => setDraft(value)}
    >
      {value}
    </button>
  )
}
