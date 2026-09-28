import { useCallback, useEffect, useState, type ReactNode } from 'react'

import { deleteMeeting, listMeetings, patchMeeting, putMeeting } from '../lib/meetingStore'
import type { MeetingRecord } from '../types/meeting'
import { MeetingsContext, type MeetingsContextValue } from './meetingsContext'

interface MeetingsProviderProps {
  children: ReactNode
}

export default function MeetingsProvider({ children }: MeetingsProviderProps) {
  const [meetings, setMeetings] = useState<MeetingRecord[]>([])
  const [isLoaded, setIsLoaded] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setMeetings(await listMeetings())
    } catch (error) {
      // 저장소가 막힌 환경(시크릿 창 등)에서는 목록이 비어 있는 채로 동작한다
      console.warn('기록 목록을 읽지 못했습니다:', error)
    } finally {
      setIsLoaded(true)
    }
  }, [])

  // IndexedDB는 외부 시스템이라 마운트 때 한 번 읽는다. 언마운트 뒤 도착한 결과는 버린다
  useEffect(() => {
    let isActive = true

    listMeetings()
      .then((rows) => {
        if (isActive) setMeetings(rows)
      })
      .catch((error: unknown) => console.warn('기록 목록을 읽지 못했습니다:', error))
      .finally(() => {
        if (isActive) setIsLoaded(true)
      })

    return () => {
      isActive = false
    }
  }, [])

  const value: MeetingsContextValue = {
    meetings,
    isLoaded,
    refresh,
    save: async (meeting) => {
      await putMeeting(meeting)
      await refresh()
    },
    patch: async (params) => {
      await patchMeeting(params)
      await refresh()
    },
    remove: async (id) => {
      await deleteMeeting(id)
      await refresh()
    }
  }

  return <MeetingsContext.Provider value={value}>{children}</MeetingsContext.Provider>
}
