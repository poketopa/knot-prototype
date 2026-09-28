import { rm } from 'node:fs/promises'
import { clearAudioPath, deleteMeeting, findAudioPath } from '../db/meetings'

/**
 * 원본 WAV를 지우고 DB의 경로를 비운다. 잡이 성공했을 때만 부른다 —
 * 실패한 잡은 재시도용으로 원본을 남긴다 (references/architecture.md).
 */
export const discardRecording = async ({ meetingId }: { meetingId: string }) => {
  const audioPath = findAudioPath({ meetingId })
  if (!audioPath) return

  await rm(audioPath, { force: true })
  clearAudioPath({ meetingId })
}

/** 회의 행(발화·화자는 CASCADE)과 원본 WAV를 함께 지운다. 없는 회의면 false */
export const deleteMeetingWithRecording = async ({ meetingId }: { meetingId: string }) => {
  const audioPath = findAudioPath({ meetingId })
  if (!deleteMeeting({ meetingId })) return false

  if (audioPath) await rm(audioPath, { force: true })

  return true
}
