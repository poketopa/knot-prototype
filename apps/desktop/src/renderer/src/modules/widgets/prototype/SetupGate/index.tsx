import { useEffect, useState, type ReactNode } from 'react'
import Button from '@renderer/shared/components/primitives/ui/Button'
import { getSetupStatusApi } from '@renderer/shared/api/setup'

interface SetupGateProps {
  children: ReactNode
  renderSetup: (onComplete: () => void) => ReactNode
}

/** 로그인 후 최초 설정이 완료된 경우에만 녹음과 개인 문서 화면을 연다. */
export default function SetupGate({ children, renderSetup }: SetupGateProps) {
  const [isComplete, setIsComplete] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let isMounted = true
    getSetupStatusApi()
      .then((status) => {
        if (isMounted) setIsComplete(status.isComplete)
      })
      .catch(() => {
        if (isMounted) setError('처음 설정 상태를 확인하지 못했습니다')
      })
    return () => {
      isMounted = false
    }
  }, [attempt])

  if (error)
    return (
      <main>
        <p role="alert">{error}</p>
        <Button
          onClick={() => {
            setError(null)
            setAttempt(attempt + 1)
          }}
        >
          다시 시도
        </Button>
      </main>
    )
  if (isComplete === null) return <p role="status">처음 설정을 확인하는 중입니다…</p>
  if (!isComplete) return renderSetup(() => setIsComplete(true))
  return children
}
