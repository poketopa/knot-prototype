/**
 * 데스크탑 앱이 내려받는 모델 목록의 단일 정의. 온보딩 다운로더(main)와
 * `apps/desktop/scripts/setupModels.ts`가 함께 쓴다 (`references/distribution.md`).
 * electron·node API를 import하지 않는 순수 데이터·함수여야 앱과 스크립트가 같은 파일을 쓴다.
 */

/** 사용자가 고를 수 있는 음성 인식 모델 (Phase 4) */
export type WhisperModelId = 'turbo-q5' | 'large-v3-q5' | 'small-q5_1'

/** 모델 파일 종류. 'summary'만 선택 모델이고 나머지는 필수다 */
export type ModelKey = 'whisper' | 'vad' | 'segmentation' | 'embedding' | 'summary'

interface BaseModelAsset {
  key: ModelKey
  /** 사용자에게 보여 줄 한국어 이름 */
  label: string
  /** userData/models 아래에 놓이는 최종 파일명 */
  fileName: string
  url: string
  sha256: string
  /** 내려받는 바이트 수. 아카이브면 아카이브 자체의 크기다 (진행률·총 용량 표시용) */
  downloadBytes: number
}

export interface DirectModelAsset extends BaseModelAsset {
  kind: 'direct'
}

export interface ArchiveModelAsset extends BaseModelAsset {
  kind: 'archive'
  archiveName: string
  /** 아카이브 안에서 꺼낼 경로 */
  entry: string
}

export type ModelAsset = DirectModelAsset | ArchiveModelAsset

export interface WhisperModelOption {
  id: WhisperModelId
  label: string
  /** 선택 화면에 붙는 한 줄 설명 (docs/phase1-results.md 측정 근거) */
  description: string
  asset: DirectModelAsset
}

const WHISPER_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'
const SHERPA_SEGMENTATION_URL =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models'
const SHERPA_EMBEDDING_URL =
  'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models'

const QWEN_BASE_URL = 'https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main'

const EMBEDDING_FILE_NAME = '3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx'
const SEGMENTATION_ARCHIVE_NAME = 'sherpa-onnx-pyannote-segmentation-3-0.tar.bz2'

export const DEFAULT_WHISPER_MODEL_ID: WhisperModelId = 'turbo-q5'

/** 표시 순서 = 권장 → 고품질 → 저사양 */
export const WHISPER_MODEL_OPTIONS: WhisperModelOption[] = [
  {
    id: 'turbo-q5',
    label: '기본 (권장)',
    description: '한국어 정확도와 속도의 균형이 가장 좋습니다',
    asset: {
      kind: 'direct',
      key: 'whisper',
      label: '음성 인식 모델 (기본)',
      fileName: 'ggml-large-v3-turbo-q5_0.bin',
      url: `${WHISPER_BASE_URL}/ggml-large-v3-turbo-q5_0.bin`,
      sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
      downloadBytes: 574041195
    }
  },
  {
    id: 'large-v3-q5',
    label: '고품질',
    description: '전문 용어를 조금 더 정확히 받아쓰지만 기본보다 2배 이상 느립니다',
    asset: {
      kind: 'direct',
      key: 'whisper',
      label: '음성 인식 모델 (고품질)',
      fileName: 'ggml-large-v3-q5_0.bin',
      url: `${WHISPER_BASE_URL}/ggml-large-v3-q5_0.bin`,
      sha256: 'd75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1',
      downloadBytes: 1081140203
    }
  },
  {
    id: 'small-q5_1',
    label: '저사양',
    description: '메모리가 적은 컴퓨터용입니다. 한국어 오인식이 늘어납니다',
    asset: {
      kind: 'direct',
      key: 'whisper',
      label: '음성 인식 모델 (저사양)',
      fileName: 'ggml-small-q5_1.bin',
      url: `${WHISPER_BASE_URL}/ggml-small-q5_1.bin`,
      sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb',
      downloadBytes: 190085487
    }
  }
]

/** 선택지가 없는 필수 모델 — 무음 감지·화자 분할·화자 임베딩 */
export const REQUIRED_MODEL_ASSETS: ModelAsset[] = [
  {
    kind: 'direct',
    key: 'vad',
    label: '무음 감지 모델',
    fileName: 'ggml-silero-v5.1.2.bin',
    url: 'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin',
    sha256: '29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf',
    downloadBytes: 885098
  },
  {
    kind: 'archive',
    key: 'segmentation',
    label: '화자 분할 모델',
    fileName: 'sherpa-onnx-pyannote-segmentation-3-0.onnx',
    url: `${SHERPA_SEGMENTATION_URL}/${SEGMENTATION_ARCHIVE_NAME}`,
    sha256: '24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488',
    downloadBytes: 6958444,
    archiveName: SEGMENTATION_ARCHIVE_NAME,
    entry: 'sherpa-onnx-pyannote-segmentation-3-0/model.onnx'
  },
  {
    kind: 'direct',
    key: 'embedding',
    label: '화자 임베딩 모델',
    fileName: EMBEDDING_FILE_NAME,
    url: `${SHERPA_EMBEDDING_URL}/${EMBEDDING_FILE_NAME}`,
    sha256: '1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b',
    downloadBytes: 39593761
  }
]

/**
 * 로컬 요약 모델 (Phase 5). **필수 모델이 아니다** — 없으면 요약 버튼만 막히고
 * 녹음·회의록 생성은 그대로 된다. 그래서 `REQUIRED_MODEL_ASSETS`에 넣지 않는다.
 * Qwen3-4B-Instruct-2507은 Apache-2.0이고 사고 과정(<think>)을 내지 않는 instruct 계열이다.
 */
export const SUMMARY_MODEL_ASSET: DirectModelAsset = {
  kind: 'direct',
  key: 'summary',
  label: '요약 모델',
  fileName: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf',
  url: `${QWEN_BASE_URL}/Qwen3-4B-Instruct-2507-Q4_K_M.gguf`,
  sha256: '3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597',
  downloadBytes: 2497281120
}

export const isWhisperModelId = (value: unknown): value is WhisperModelId =>
  WHISPER_MODEL_OPTIONS.some((option) => option.id === value)

/** 모르는 id(설정 파일이 손상된 경우 등)는 기본 모델로 되돌린다 */
export const whisperModelOptionOf = (id: WhisperModelId) =>
  WHISPER_MODEL_OPTIONS.find((option) => option.id === id) ??
  (WHISPER_MODEL_OPTIONS.find(
    (option) => option.id === DEFAULT_WHISPER_MODEL_ID
  ) as WhisperModelOption)

export const whisperFileNameOf = (id: WhisperModelId) => whisperModelOptionOf(id).asset.fileName

/** 고른 모델 하나 + 필수 모델 전부. 온보딩이 실제로 내려받는 목록이다 */
export const modelAssetsOf = ({
  whisperModelId
}: {
  whisperModelId: WhisperModelId
}): ModelAsset[] => [whisperModelOptionOf(whisperModelId).asset, ...REQUIRED_MODEL_ASSETS]

export const totalDownloadBytesOf = ({ assets }: { assets: ModelAsset[] }) =>
  assets.reduce((total, asset) => total + asset.downloadBytes, 0)
