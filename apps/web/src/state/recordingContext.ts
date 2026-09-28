import { createContext, useContext } from 'react'

export interface RecordingContextValue {
  isRecording: boolean
  /** 시작·정지 처리 중. 버튼을 잠근다 */
  isBusy: boolean
  /** 0~1 입력 세기, 오래된 것부터 */
  levels: number[]
  elapsedSec: number
  errorMessage: string | null
  /** 시작 화면과 녹음 화면이 같은 값을 본다. 문자열인 이유는 Stepper 계약 */
  speakerCountText: string
  setSpeakerCountText: (text: string) => void
  /** 검증을 통과한 참석자 수. 아니면 null */
  speakerCount: number | null
  start: () => Promise<void>
  /** 정지 → 기록 저장 → 파이프라인 시작 → 기록 화면으로 이동 */
  stop: () => Promise<void>
}

export const RecordingContext = createContext<RecordingContextValue | null>(null)

export const useRecording = () => {
  const value = useContext(RecordingContext)
  if (!value) throw new Error('useRecording은 RecordingProvider 안에서만 쓸 수 있다')

  return value
}
