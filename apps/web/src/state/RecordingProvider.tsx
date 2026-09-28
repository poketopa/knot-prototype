import { useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'

import type { Recording } from '../audio/recorder'
import { defaultMeetingTitle } from '../lib/dateFormat'
import { newMeetingId } from '../lib/meetingStore'
import { parseSpeakerCount } from '../lib/speakerCount'
import { PATHS, meetingPath } from '../routes/paths'
import type { MeetingRecord } from '../types/meeting'
import useRecorder from '../ui/useRecorder'
import { useJob } from './jobContext'
import { useMeetings } from './meetingsContext'
import { RecordingContext, type RecordingContextValue } from './recordingContext'

interface RecordingProviderProps {
  children: ReactNode
}

const DEFAULT_SPEAKER_COUNT_TEXT = ''
/** 정지 버튼이 잠겨 있어 비어 있을 수 없지만, 만약을 위해 1명으로 막는다 */
const FALLBACK_SPEAKER_COUNT = 1

const toMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** 녹음은 화면을 옮겨도 이어져야 하므로(사이드바가 "녹음 중"을 보여 준다) 셸 수준에서 소유한다 */
export default function RecordingProvider({ children }: RecordingProviderProps) {
  const [speakerCountText, setSpeakerCountText] = useState(DEFAULT_SPEAKER_COUNT_TEXT)
  const [saveError, setSaveError] = useState<string | null>(null)
  // 정지 뒤 저장·이동이 끝날 때까지 true. 녹음 화면이 그 사이에 시작 화면으로 튕기지 않게 한다
  const [isFinishing, setIsFinishing] = useState(false)
  const isHandlingRef = useRef(false)
  const navigate = useNavigate()
  const { save } = useMeetings()
  const { start: startJob } = useJob()
  const speakerCount = parseSpeakerCount(speakerCountText)

  const handleRecorded = async (recording: Recording) => {
    isHandlingRef.current = true
    const createdAt = Date.now()
    const meeting: MeetingRecord = {
      id: newMeetingId(),
      title: defaultMeetingTitle(createdAt),
      createdAt,
      durationSec: recording.durationSec,
      speakerCount: parseSpeakerCount(speakerCountText) ?? FALLBACK_SPEAKER_COUNT,
      status: 'recorded',
      audio: recording.file,
      audioName: recording.file.name,
      utterances: [],
      speakerNames: {},
      processing: null,
      errorMessage: null
    }

    try {
      await save(meeting)
      startJob(meeting)
      void navigate(meetingPath(meeting.id))
    } catch (error) {
      setSaveError(`녹음을 저장하지 못했습니다: ${toMessage(error)}`)
    } finally {
      isHandlingRef.current = false
      setIsFinishing(false)
    }
  }

  const recorder = useRecorder({ onRecorded: (recording) => void handleRecorded(recording) })

  const value: RecordingContextValue = {
    isRecording: recorder.isRecording,
    isBusy: recorder.isBusy || isFinishing,
    levels: recorder.levels,
    elapsedSec: recorder.elapsedSec,
    errorMessage: recorder.errorMessage ?? saveError,
    speakerCountText,
    setSpeakerCountText,
    speakerCount,
    start: async () => {
      setSaveError(null)
      await recorder.start()
      void navigate(PATHS.record)
    },
    stop: async () => {
      setIsFinishing(true)
      await recorder.stop()
      // 정지가 실패하면 onRecorded가 불리지 않는다. 그때는 여기서 풀어야 화면이 잠기지 않는다
      if (!isHandlingRef.current) setIsFinishing(false)
    }
  }

  return <RecordingContext.Provider value={value}>{children}</RecordingContext.Provider>
}
