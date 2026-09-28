/**
 * 참석자 수의 허용 범위. 임계값 군집은 긴 녹음에서 화자가 무한정 늘어나므로 두 앱 모두
 * 참석자 수를 받아 군집 수를 고정하는 것이 기본 경로다 (데스크탑은 sherpa-onnx의
 * `--clustering.num-clusters`, 웹은 AHC의 `clusterCount`). 상한은 회의실 규모 기준이며
 * 두 엔진의 제약이 아니다 (`references/architecture.md`).
 */
export const MIN_SPEAKER_COUNT = 1
export const MAX_SPEAKER_COUNT = 20

/** 정수이면서 허용 범위 안인지. 입력 UI와 payload 검증이 같은 기준을 쓴다 */
export const isValidSpeakerCount = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= MIN_SPEAKER_COUNT &&
  value <= MAX_SPEAKER_COUNT
