import type { ClipboardEvent, KeyboardEvent } from 'react'
import Icon from '@renderer/shared/components/primitives/ui/Icon'

import type { TermEntry } from '../types/termRow'
import { autoReadingOf, isTermListText, sanitizeTerm } from '../utils/termLines'
import styles from './TermRow.module.css'

const TERM_PLACEHOLDER = '예: GitHub'
const READINGS_PLACEHOLDER = '예: 깃허브, 기트허브'
const DELETE_ICON_SIZE = 14

interface TermRowProps extends TermEntry {
  position: number
  isAutoFocus: boolean
  isDisabled: boolean
  onChange: (patch: Partial<TermEntry>) => void
  onRemove: () => void
  onPasteList: (text: string) => void
  onEnter: () => void
}

/** 용어 한 행. 구분자(`=`·쉼표)는 사용자가 치지 않고 칸으로 나눈다 */
export default function TermRow({
  position,
  term,
  readings,
  isAutoFocus,
  isDisabled,
  onChange,
  onRemove,
  onPasteList,
  onEnter
}: TermRowProps) {
  const autoReading = autoReadingOf({ term, readings })

  const handleTermPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text')
    if (!isTermListText(text)) return

    event.preventDefault()
    onPasteList(text)
  }

  // 한글 조합 중의 Enter는 글자 확정이라 새 행을 만들지 않는다
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return

    event.preventDefault()
    onEnter()
  }

  return (
    <li className={styles.termRow}>
      <input
        className={styles.input}
        aria-label={`용어 ${position}`}
        placeholder={TERM_PLACEHOLDER}
        value={term}
        onChange={(event) => onChange({ term: sanitizeTerm(event.target.value) })}
        onPaste={handleTermPaste}
        onKeyDown={handleKeyDown}
        disabled={isDisabled}
        autoFocus={isAutoFocus}
        spellCheck={false}
      />
      <input
        className={styles.input}
        aria-label={`용어 ${position} 한글 읽기`}
        placeholder={autoReading ?? READINGS_PLACEHOLDER}
        value={readings}
        onChange={(event) => onChange({ readings: event.target.value })}
        onKeyDown={handleKeyDown}
        disabled={isDisabled}
        spellCheck={false}
      />
      <button
        className={styles.removeButton}
        type="button"
        aria-label={`용어 ${position} 삭제`}
        onClick={onRemove}
        disabled={isDisabled}
      >
        <Icon name="close" size={DELETE_ICON_SIZE} />
      </button>
    </li>
  )
}
