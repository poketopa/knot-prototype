import { useState } from 'react'
import { writeClipboardTextApi } from '@renderer/shared/api/clipboard'

const COPY_ERROR_MESSAGE = '요약을 복사하지 못했습니다'

const useSummaryCopy = ({ summary }: { summary: string }) => {
  const [isCopied, setIsCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)

  const copySummary = async () => {
    try {
      await writeClipboardTextApi({ text: summary })
      setIsCopied(true)
      setCopyError(null)
    } catch (caught) {
      setIsCopied(false)
      setCopyError(caught instanceof Error ? caught.message : COPY_ERROR_MESSAGE)
    }
  }

  return { isCopied, copyError, copySummary }
}

export default useSummaryCopy
