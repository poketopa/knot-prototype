import { useEffect, useState, type KeyboardEvent } from 'react'
import { acceleratorFromKeyInput } from '@shared/shortcut'
import { setShortcutsSuspendedApi } from '@renderer/shared/api/settings'

interface UseShortcutCaptureParams {
  onCapture: (accelerator: string) => void
}

const ESCAPE_KEY = 'Escape'

const useShortcutCapture = ({ onCapture }: UseShortcutCaptureParams) => {
  const [isCapturing, setIsCapturing] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  // 입력받는 동안 전역 단축키를 풀어 둔다. 그대로 두면 현재 단축키를 누르는 순간 녹음이 시작된다.
  // 확정·취소·언마운트 어느 경로로 끝나도 cleanup이 다시 등록한다
  useEffect(() => {
    if (!isCapturing) return

    const handleFailure = () => setError(new Error('단축키 입력 상태를 바꾸지 못했습니다'))
    setShortcutsSuspendedApi({ isSuspended: true }).catch(handleFailure)

    return () => {
      setShortcutsSuspendedApi({ isSuspended: false }).catch(handleFailure)
    }
  }, [isCapturing])

  const startCapture = () => {
    setError(null)
    setIsCapturing(true)
  }

  const stopCapture = () => setIsCapturing(false)

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!isCapturing) return
    event.preventDefault()

    if (event.key === ESCAPE_KEY) {
      stopCapture()

      return
    }

    const accelerator = acceleratorFromKeyInput(event)
    if (!accelerator) return

    stopCapture()
    onCapture(accelerator)
  }

  return { isCapturing, error, startCapture, stopCapture, handleKeyDown }
}

export default useShortcutCapture
