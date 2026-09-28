import { useCallback, useEffect, useRef, useState } from 'react'

import { startRecorder, type Recorder, type Recording } from '../audio/recorder'

const ELAPSED_TICK_MS = 200
const MS_PER_SEC = 1000
/** 파형형 레벨 미터가 그리는 칸 수만큼만 들고 있는다 (청크 약 0.13초 × 48 ≈ 6초) */
export const LEVEL_HISTORY_SIZE = 48

interface UseRecorderParams {
  /** 정지 직후 호출된다. 호출한 쪽이 이 녹음을 파이프라인 입력으로 넣는다 */
  onRecorded: (recording: Recording) => void
}

const messageOf = (caught: unknown) =>
  caught instanceof Error ? caught.message : '녹음 중 알 수 없는 오류가 발생했습니다'

const useRecorder = ({ onRecorded }: UseRecorderParams) => {
  const [isRecording, setIsRecording] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [levels, setLevels] = useState<number[]>([])
  const [elapsedSec, setElapsedSec] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const recorderRef = useRef<Recorder | null>(null)

  const start = useCallback(async () => {
    setErrorMessage(null)
    setIsBusy(true)

    try {
      setLevels([])
      recorderRef.current = await startRecorder({
        onLevel: (next) => setLevels((previous) => [...previous, next].slice(-LEVEL_HISTORY_SIZE))
      })
      setElapsedSec(0)
      setIsRecording(true)
    } catch (caught) {
      setErrorMessage(messageOf(caught))
    } finally {
      setIsBusy(false)
    }
  }, [])

  const stop = useCallback(async () => {
    const recorder = recorderRef.current
    if (!recorder) return

    recorderRef.current = null
    setIsBusy(true)

    try {
      onRecorded(await recorder.stop())
    } catch (caught) {
      setErrorMessage(messageOf(caught))
    } finally {
      setIsRecording(false)
      setLevels([])
      setIsBusy(false)
    }
  }, [onRecorded])

  useEffect(() => {
    if (!isRecording) return

    const startedAt = Date.now()
    const timer = setInterval(
      () => setElapsedSec((Date.now() - startedAt) / MS_PER_SEC),
      ELAPSED_TICK_MS
    )

    return () => clearInterval(timer)
  }, [isRecording])

  // 녹음 중 새로고침·탭 닫기는 녹음을 통째로 날린다. 디스크에 쓰지 않는 구성이라 경고까지만 한다 (계획 §7)
  useEffect(() => {
    if (!isRecording) return

    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)

    return () => window.removeEventListener('beforeunload', warn)
  }, [isRecording])

  // 화면을 벗어나도 마이크 트랙과 AudioContext는 닫아야 한다
  useEffect(
    () => () => {
      void recorderRef.current?.cancel()
      recorderRef.current = null
    },
    []
  )

  return { isRecording, isBusy, levels, elapsedSec, errorMessage, start, stop }
}

export default useRecorder
