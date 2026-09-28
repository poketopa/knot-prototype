/**
 * 두 앱이 공유하는 오디오 형식. whisper.cpp·sherpa-onnx·transformers.js 모두
 * 16kHz mono를 요구하므로 녹음·디코딩 단계에서부터 이 형식으로 맞춰 변환 단계를 없앤다.
 * 녹음 청크 크기처럼 앱마다 다른 값은 각 앱에 둔다 (데스크탑 8192 / 웹 2048).
 */
export const SAMPLE_RATE_HZ = 16000
export const CHANNELS = 1
export const BITS_PER_SAMPLE = 16
