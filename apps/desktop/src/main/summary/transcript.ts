import { formatTranscript } from '@meeting-stt/core/format'
import { listSpeakers } from '../db/speakers'
import { listUtterances } from '../db/utterances'

/**
 * DB의 발화·화자를 요약 입력용 회의록 텍스트로 만든다.
 * 사용자가 지정한 화자 이름을 그대로 넣어야 요약의 "다음 할 일"에 실제 이름이 나온다.
 */
export const buildTranscriptText = ({ meetingId }: { meetingId: string }) => {
  const utterances = listUtterances({ meetingId })
  const displayNames = Object.fromEntries(
    listSpeakers({ meetingId }).map((speaker) => [speaker.label, speaker.displayName])
  )

  return formatTranscript({ utterances, displayNames })
}
