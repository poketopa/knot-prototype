/**
 * 받아 둔 모델이 Cache Storage에 남아 있는지 본다.
 *
 * transformers.js는 **캐시에서 읽을 때도** `download` 진행률 이벤트를 그대로 쏘기 때문에
 * (`hub.js`가 `cacheHit`을 판정해 놓고 콜백은 조건 없이 부른다), 진행률만 봐서는
 * 네트워크를 쓰는지 알 수 없다. 화면에서 둘을 구분하려면 캐시를 직접 들여다봐야 한다 (계획 §7).
 */

import type { DtypeKind, WhisperModelKind } from '../pipeline/messages'
import {
  EMBEDDING_MODEL_ID,
  FP32_ONNX_FILE,
  SEGMENTATION_MODEL_ID,
  VAD_MODEL_ID,
  WHISPER_MODEL_IDS,
  whisperOnnxFiles
} from '@meeting-stt/models/web'

/** transformers.js `env.cacheKey`의 기본값 */
const CACHE_NAME = 'transformers-cache'
/** 브라우저 캐시의 키는 `env.remoteHost` + `remotePathTemplate`로 만들어진 원본 URL이다 */
const HF_HOST = 'https://huggingface.co'

const fileUrl = ({ modelId, file }: { modelId: string; file: string }) =>
  `${HF_HOST}/${modelId}/resolve/main/${file}`

interface CachedFile {
  label: string
  url: string
}

interface ProbeModelCacheParams {
  whisperModel: WhisperModelKind
  sttDtype: DtypeKind
}

export interface ModelCacheInfo {
  /** Cache Storage를 들여다볼 수 있었는지. 비보안 컨텍스트나 시크릿 창에서는 false다 */
  isReadable: boolean
  cachedCount: number
  totalCount: number
  /** 아직 받지 않은 파일의 이름표 */
  missingLabels: string[]
}

const filesToCheck = ({ whisperModel, sttDtype }: ProbeModelCacheParams): CachedFile[] => {
  const [encoderFile, decoderFile] = whisperOnnxFiles(sttDtype)
  const whisperModelId = WHISPER_MODEL_IDS[whisperModel]

  return [
    { label: 'STT 인코더', url: fileUrl({ modelId: whisperModelId, file: encoderFile }) },
    { label: 'STT 디코더', url: fileUrl({ modelId: whisperModelId, file: decoderFile }) },
    { label: 'VAD', url: fileUrl({ modelId: VAD_MODEL_ID, file: FP32_ONNX_FILE }) },
    { label: '화자 분할', url: fileUrl({ modelId: SEGMENTATION_MODEL_ID, file: FP32_ONNX_FILE }) },
    { label: '화자 임베딩', url: fileUrl({ modelId: EMBEDDING_MODEL_ID, file: FP32_ONNX_FILE }) }
  ]
}

/**
 * 고른 모델·dtype 조합이 이미 캐시에 있는지 센다.
 * `caches.match`에 `cacheName`을 주면 캐시가 없을 때 새로 만들지 않는다.
 */
export const probeModelCache = async (params: ProbeModelCacheParams): Promise<ModelCacheInfo> => {
  const targets = filesToCheck(params)
  const empty: ModelCacheInfo = {
    isReadable: false,
    cachedCount: 0,
    totalCount: targets.length,
    missingLabels: []
  }

  if (typeof caches === 'undefined') return empty

  try {
    const hits = await Promise.all(
      targets.map(async ({ label, url }) => ({
        label,
        isCached: (await caches.match(url, { cacheName: CACHE_NAME })) !== undefined
      }))
    )

    return {
      isReadable: true,
      cachedCount: hits.filter(({ isCached }) => isCached).length,
      totalCount: hits.length,
      missingLabels: hits.filter(({ isCached }) => !isCached).map(({ label }) => label)
    }
  } catch (error) {
    // 시크릿 창의 iframe 등에서 보안 정책으로 막힌다. 실행 자체에는 지장이 없다
    console.warn('모델 캐시를 확인하지 못했습니다:', error)
    return empty
  }
}
