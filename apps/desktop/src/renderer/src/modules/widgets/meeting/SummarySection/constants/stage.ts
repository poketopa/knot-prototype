import type { SummaryStage } from '@shared/types'

/** 진행 중에 보여 줄 한국어 안내. 'done'·'error'는 본문이 대신 바뀌므로 짧게 둔다 */
export const STAGE_MESSAGES: Record<SummaryStage, string> = {
  summarize: '회의록을 읽고 요약하는 중입니다',
  reduce: '구간별 요약을 하나로 정리하는 중입니다',
  done: '요약을 마쳤습니다',
  error: '요약에 실패했습니다'
}
