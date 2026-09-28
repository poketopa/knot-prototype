import { useEffect, useRef, useState } from 'react'
import { formatTranscript, type TranscriptFormat } from '@meeting-stt/core/format'
import type { Utterance } from '@shared/types'
import { writeClipboardTextApi } from '@renderer/shared/api/clipboard'

/** "복사했습니다" 표시를 유지하는 시간 */
const COPIED_FEEDBACK_MS = 2000

interface UseTranscriptCopyParams {
  utterances: Utterance[]
  /** 라벨 → 화면에 보이는 이름. 발화 하나만 복사해도 번호가 1부터 다시 매겨지지 않도록 그대로 넘긴다 */
  speakerNames: Record<string, string>
}

interface CopyParams {
  key: string
  targets: Utterance[]
  format: TranscriptFormat
}

const useTranscriptCopy = ({ utterances, speakerNames }: UseTranscriptCopyParams) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [copyError, setCopyError] = useState<Error | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    []
  )

  const copy = async ({ key, targets, format }: CopyParams) => {
    try {
      await writeClipboardTextApi({
        text: formatTranscript({ utterances: targets, displayNames: speakerNames, format })
      })
      setCopyError(null)
      setCopiedKey(key)

      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopiedKey(null), COPIED_FEEDBACK_MS)
    } catch (caught) {
      setCopyError(caught instanceof Error ? caught : new Error('복사하지 못했습니다'))
    }
  }

  return {
    copiedKey,
    copyError,
    copyAll: ({ format }: { format: TranscriptFormat }) =>
      copy({ key: format, targets: utterances, format }),
    copyUtterance: ({ utterance }: { utterance: Utterance }) =>
      copy({ key: utterance.id, targets: [utterance], format: 'plain' })
  }
}

export default useTranscriptCopy
