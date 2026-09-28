import type { PipelineStage } from '../pipeline/messages'

/** 진행률과 측정값이 같은 이름으로 나와야 두 패널을 나란히 읽을 수 있다 */
export const STAGE_LABELS: Record<PipelineStage, string> = {
  decode: '디코딩',
  diarize: '화자 분리',
  stt: '음성 인식',
  merge: '병합'
}
