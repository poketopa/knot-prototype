import { createContext, useContext } from 'react'

import type { MeetingRecord } from '../types/meeting'

/** 처리 화면이 그리는 단계. 실행 순서는 `runPipeline`과 같다 (계획 §10 "처리 화면의 단계") */
export type JobStep = 'diarize' | 'stt' | 'merge'

export type JobStepStatus = 'waiting' | 'downloading' | 'running' | 'done'

export interface JobStepState {
  status: JobStepStatus
  /** `downloading`이면 받기 진행률, `running`이면 추론 진행률 (0~100) */
  percent: number
  note: string
}

export interface JobState {
  meetingId: string
  steps: Record<JobStep, JobStepState>
  overallPercent: number
  /** 실행 전 캐시 조회에서 빠진 모델이 있었는지. 있으면 "처음 한 번" 안내를 붙인다 */
  isDownloadExpected: boolean
}

export interface JobContextValue {
  job: JobState | null
  /** 기록의 오디오로 파이프라인을 돌린다. 이미 도는 잡이 있으면 무시한다 */
  start: (meeting: MeetingRecord) => void
  cancel: () => void
}

export const JobContext = createContext<JobContextValue | null>(null)

export const useJob = () => {
  const value = useContext(JobContext)
  if (!value) throw new Error('useJob은 JobProvider 안에서만 쓸 수 있다')

  return value
}
