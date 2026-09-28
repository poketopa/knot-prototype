import { createContext, useContext } from 'react'

import type { MeetingRecord } from '../types/meeting'

export interface MeetingsContextValue {
  /** 최근 기록부터. 저장소를 읽기 전에는 빈 배열이다 */
  meetings: MeetingRecord[]
  isLoaded: boolean
  /** 저장소를 다시 읽는다. 기록을 바꾼 쪽이 부른다 */
  refresh: () => Promise<void>
  save: (meeting: MeetingRecord) => Promise<void>
  patch: (params: { id: string; patch: Partial<Omit<MeetingRecord, 'id'>> }) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const MeetingsContext = createContext<MeetingsContextValue | null>(null)

export const useMeetings = () => {
  const value = useContext(MeetingsContext)
  if (!value) throw new Error('useMeetings는 MeetingsProvider 안에서만 쓸 수 있다')

  return value
}
