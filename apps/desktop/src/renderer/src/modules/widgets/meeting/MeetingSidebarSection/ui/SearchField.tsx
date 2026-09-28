import type { KeyboardEvent } from 'react'
import Icon from '@renderer/shared/components/primitives/ui/Icon'

import styles from './SearchField.module.css'

interface SearchFieldProps {
  value: string
  onChange: (value: string) => void
}

/** Esc나 지우기 버튼으로 검색을 끝내면 원래 목록으로 돌아간다 */
export default function SearchField({ value, onChange }: SearchFieldProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape' || !value) return
    event.preventDefault()
    onChange('')
  }

  return (
    <label className={styles.field}>
      <Icon name="search" size={15} />
      <input
        className={styles.input}
        type="text"
        placeholder="회의록 검색"
        aria-label="회의록 검색"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
      />
      {value ? (
        <button
          type="button"
          className={styles.clear}
          aria-label="검색 지우기"
          onClick={() => onChange('')}
        >
          <Icon name="close" size={13} />
        </button>
      ) : null}
    </label>
  )
}
