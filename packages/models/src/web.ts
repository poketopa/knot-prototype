/**
 * 브라우저 앱이 쓰는 모델 저장소 id와 dtype별 ONNX 파일 이름.
 * 워커(실제 로드)와 환경 패널(캐시 조회)이 같은 값을 봐야 하므로 한 곳에 둔다.
 * 워커 모듈에서 가져오면 메인 스레드가 워커 본문을 평가하게 되므로 워커 메시지 계약과도 분리한다.
 */

/** 양자화 종류. q4f16은 WebGPU의 shader-f16 기능이 있어야 돌아간다 */
export type DtypeKind = 'q4f16' | 'q4' | 'fp32'

/** 고를 수 있는 Whisper 크기. RTF 판단선을 넘으면 small로 낮춰 보라고 계획에 적혀 있다 (계획 §6) */
export type WhisperModelKind = 'large-v3-turbo' | 'small' | 'tiny'

export const VAD_MODEL_ID = 'onnx-community/silero-vad'
export const SEGMENTATION_MODEL_ID = 'onnx-community/pyannote-segmentation-3.0'
export const EMBEDDING_MODEL_ID = 'onnx-community/wespeaker-voxceleb-resnet34-LM'

/**
 * `_timestamped` 저장소를 쓰는 이유: 기본 export에는 cross-attention 출력이 없어서
 * `return_timestamps: 'word'`가 "Model outputs must contain cross attentions"로 죽는다.
 * 가중치와 파일 크기는 같고 디코더에 attention 출력만 더 달려 있다.
 */
export const WHISPER_MODEL_IDS: Record<WhisperModelKind, string> = {
  'large-v3-turbo': 'onnx-community/whisper-large-v3-turbo_timestamped',
  small: 'onnx-community/whisper-small_timestamped',
  tiny: 'onnx-community/whisper-tiny_timestamped'
}

/** VAD·분할·임베딩은 fp32로 돌리므로 접미사가 붙지 않는다 */
export const FP32_ONNX_FILE = 'onnx/model.onnx'

/** transformers.js의 `DEFAULT_DTYPE_SUFFIX_MAPPING`과 같아야 한다 */
const DTYPE_SUFFIXES: Record<DtypeKind, string> = {
  fp32: '',
  q4: '_q4',
  q4f16: '_q4f16'
}

/**
 * Whisper는 인코더·디코더가 따로 받아진다.
 * fp32 인코더는 가중치가 `.onnx_data`로 빠지지만, 캐시 조회 목적에는 본체만 봐도 충분하다.
 */
export const whisperOnnxFiles = (dtype: DtypeKind) => [
  `onnx/encoder_model${DTYPE_SUFFIXES[dtype]}.onnx`,
  `onnx/decoder_model_merged${DTYPE_SUFFIXES[dtype]}.onnx`
]
