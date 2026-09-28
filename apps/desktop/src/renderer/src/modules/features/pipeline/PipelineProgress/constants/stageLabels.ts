import type { PipelineStage } from '@shared/types'

export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  stt: '음성 인식 중',
  diarize: '화자 구분 중',
  merge: '회의록 정리 중',
  save: '저장 중',
  done: '완료',
  error: '오류'
}

/** 아직 진행률 이벤트가 오지 않은 상태. 앞선 회의를 처리 중이거나 막 시작한 참이다 */
export const PIPELINE_WAITING_LABEL = '차례를 기다리는 중'
