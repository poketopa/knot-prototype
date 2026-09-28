import useRecorder from '@renderer/shared/hooks/domain/recording/useRecorder'

interface RecordingCommandControllerProps {
  isReady?: boolean
}

/** 메인 창에 상시 마운트되어 Tray·전역 단축키의 녹음 명령을 처리한다. */
export default function RecordingCommandController({
  isReady = true
}: RecordingCommandControllerProps) {
  useRecorder({ isReady })

  return null
}
