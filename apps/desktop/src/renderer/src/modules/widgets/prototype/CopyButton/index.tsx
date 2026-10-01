import { useEffect, useRef, useState } from 'react'
import { writeClipboardTextApi } from '@renderer/shared/api/clipboard'
import styles from './index.module.css'

/** "복사됨" 표시를 유지하는 시간 */
const COPIED_FEEDBACK_MS = 2000

interface CopyButtonProps {
  /** 버튼을 누른 시점의 내용을 만든다. 빈 문자열이면 복사하지 않는다 */
  getText: () => string
  label?: string
  onCopied?: () => void
  className?: string
}

type CopyStatus = 'idle' | 'copied' | 'failed'

export default function CopyButton({
  getText,
  label = '복사',
  onCopied,
  className
}: CopyButtonProps) {
  const [status, setStatus] = useState<CopyStatus>('idle')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )

  const showStatus = (next: CopyStatus) => {
    setStatus(next)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setStatus('idle'), COPIED_FEEDBACK_MS)
  }

  const copy = async () => {
    const text = getText()
    if (!text) return
    try {
      await writeClipboardTextApi({ text })
      showStatus('copied')
      onCopied?.()
    } catch {
      showStatus('failed')
    }
  }

  const text = status === 'copied' ? '복사됨' : status === 'failed' ? '복사 실패' : label

  return (
    <button
      type="button"
      className={`${styles.button} ${className ?? ''}`}
      data-status={status}
      onClick={() => void copy()}
    >
      <span aria-live="polite">{text}</span>
    </button>
  )
}
