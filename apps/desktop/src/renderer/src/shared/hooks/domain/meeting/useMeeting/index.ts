import { useCallback, useEffect, useState } from 'react'
import type { MeetingDetail } from '@shared/types'
import { onPipelineProgress } from '@renderer/shared/api/events'
import { deleteMeetingApi, getMeetingApi, renameMeetingApi } from '@renderer/shared/api/meetings'
import { mergeSpeakersApi, renameSpeakerApi } from '@renderer/shared/api/speakers'
import { reassignUtteranceApi, updateUtteranceTextApi } from '@renderer/shared/api/utterances'

interface UseMeetingParams {
  meetingId: string
}

const SAVE_ERROR_MESSAGE = '변경 사항을 저장하지 못했습니다'

const useMeeting = ({ meetingId }: UseMeetingParams) => {
  const [detail, setDetail] = useState<MeetingDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [saveError, setSaveError] = useState<Error | null>(null)

  // effect에서 부르는 함수라 await 대신 프로미스 체인으로 쓴다 (useMeetings와 같은 이유)
  const fetchMeeting = useCallback(
    () =>
      getMeetingApi({ meetingId })
        .then((next) => {
          setDetail(next)
          setError(null)
        })
        .catch((caught: unknown) =>
          setError(caught instanceof Error ? caught : new Error('회의를 불러오지 못했습니다'))
        )
        .finally(() => setIsLoading(false)),
    [meetingId]
  )

  const refetch = useCallback(() => {
    setIsLoading(true)

    return fetchMeeting()
  }, [fetchMeeting])

  useEffect(() => {
    fetchMeeting()
  }, [fetchMeeting])

  // 이 회의의 처리가 끝났을 때만 다시 읽는다
  useEffect(
    () =>
      onPipelineProgress((event) => {
        if (event.meetingId !== meetingId) return
        if (event.stage === 'done' || event.stage === 'error') fetchMeeting()
      }),
    [meetingId, fetchMeeting]
  )

  /** 편집 채널은 갱신된 상세를 그대로 돌려준다 (references/architecture.md) */
  const applyMutation = async (mutate: () => Promise<MeetingDetail>) => {
    try {
      setDetail(await mutate())
      setSaveError(null)

      return true
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught : new Error(SAVE_ERROR_MESSAGE))

      return false
    }
  }

  const renameMeeting = ({ title }: { title: string }) =>
    applyMutation(() => renameMeetingApi({ meetingId, title }))

  const editUtteranceText = ({ utteranceId, text }: { utteranceId: string; text: string }) =>
    applyMutation(() => updateUtteranceTextApi({ meetingId, utteranceId, text }))

  const reassignUtterance = ({
    utteranceId,
    speakerLabel
  }: {
    utteranceId: string
    speakerLabel: string
  }) => applyMutation(() => reassignUtteranceApi({ meetingId, utteranceId, speakerLabel }))

  const renameSpeaker = ({ label, displayName }: { label: string; displayName: string }) =>
    applyMutation(() => renameSpeakerApi({ meetingId, label, displayName }))

  const mergeSpeakers = ({ fromLabel, intoLabel }: { fromLabel: string; intoLabel: string }) =>
    applyMutation(() => mergeSpeakersApi({ meetingId, fromLabel, intoLabel }))

  /** 성공하면 상세가 사라지므로 호출한 쪽이 화면을 옮긴다 */
  const removeMeeting = async () => {
    try {
      await deleteMeetingApi({ meetingId })
      setSaveError(null)

      return true
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught : new Error('회의를 지우지 못했습니다'))

      return false
    }
  }

  return {
    meeting: detail?.meeting ?? null,
    utterances: detail?.utterances ?? [],
    speakers: detail?.speakers ?? [],
    isLoading,
    error,
    saveError,
    refetch,
    renameMeeting,
    editUtteranceText,
    reassignUtterance,
    renameSpeaker,
    mergeSpeakers,
    removeMeeting
  }
}

export default useMeeting
