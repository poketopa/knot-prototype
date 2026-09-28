/**
 * 이 앱의 녹음 파라미터. 오디오 형식(16kHz mono 16bit)은 두 앱이 공유하므로
 * `@meeting-stt/core/audio`에 있고, 기존 import 경로를 유지하려고 여기서 재노출한다.
 */

export { BITS_PER_SAMPLE, CHANNELS, SAMPLE_RATE_HZ } from '@meeting-stt/core/audio'

/** AudioWorklet이 한 번에 모아 보내는 샘플 수. 16kHz에서 약 0.5초 분량 */
export const CHUNK_SAMPLES = 8192

/**
 * 청크 하나의 RMS(0~1). 레벨 미터 값을 main이 계산해 두 창에 같은 값을 보내기 위한 순수 함수다
 * (references/architecture.md의 "녹음 위젯 패널").
 */
export const rmsOf = (samples: Float32Array) => {
  if (samples.length === 0) return 0

  let sum = 0
  for (const sample of samples) sum += sample * sample

  return Math.sqrt(sum / samples.length)
}
