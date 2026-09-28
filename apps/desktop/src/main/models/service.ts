import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import type { ModelStatusResponse } from '@shared/ipc'
import { info } from '../log'
import { downloadModelAsset, type ModelDownloadProgress } from './download'
import {
  getSelectedWhisperModelId,
  isModelSetReady,
  isSummaryModelReady,
  modelInstallStates,
  modelsDir,
  setSelectedWhisperModelId
} from './paths'
import {
  SUMMARY_MODEL_ASSET,
  WHISPER_MODEL_OPTIONS,
  isWhisperModelId,
  modelAssetsOf,
  type ModelAsset
} from '@meeting-stt/models/desktop'
import { recommendWhisperModelId } from './recommend'

/** 다운로드 동시성은 1이다. 파이프라인 잡 큐와 같은 이유 (references/pitfalls.md) */
let isDownloading = false

/** 온보딩·설정 화면이 한 번에 받는 묶음 (`references/distribution.md` 3절) */
export const modelStatus = (): ModelStatusResponse => ({
  isReady: isModelSetReady(),
  isSummaryReady: isSummaryModelReady(),
  selectedWhisperModelId: getSelectedWhisperModelId(),
  recommendedWhisperModelId: recommendWhisperModelId({
    cpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem()
  }),
  whisperOptions: WHISPER_MODEL_OPTIONS.map((option) => ({
    id: option.id,
    label: option.label,
    description: option.description,
    sizeBytes: option.asset.downloadBytes
  })),
  items: modelInstallStates()
})

type ProgressListener = (progress: ModelDownloadProgress) => void

interface DownloadAssetsParams {
  assets: ModelAsset[]
  onProgress: ProgressListener
}

/** 잠금을 잡고 차례로 받는다. 받는 중에 또 요청이 오면 한국어로 거절한다 */
const downloadAssets = async ({ assets, onProgress }: DownloadAssetsParams) => {
  if (isDownloading) throw new Error('이미 모델을 내려받는 중입니다')

  isDownloading = true
  try {
    const dir = modelsDir()
    await mkdir(dir, { recursive: true })

    for (const asset of assets) {
      await downloadModelAsset({ asset, modelsDir: dir, onProgress })
      info(`모델 준비 완료: ${asset.label}`)
    }

    return modelStatus()
  } finally {
    isDownloading = false
  }
}

interface DownloadModelsParams {
  whisperModelId: unknown
  onProgress: ProgressListener
}

/**
 * 고른 음성 인식 모델과 필수 모델을 차례로 내려받는다.
 * 고른 모델을 설정(`stt.model`)에 남기는 것은 호출한 핸들러의 몫이다 — 이 모듈은 DB를 모른다.
 */
export const downloadModels = async ({ whisperModelId, onProgress }: DownloadModelsParams) => {
  if (!isWhisperModelId(whisperModelId)) throw new Error('알 수 없는 음성 인식 모델입니다')
  if (isDownloading) throw new Error('이미 모델을 내려받는 중입니다')

  setSelectedWhisperModelId(whisperModelId)

  return downloadAssets({ assets: modelAssetsOf({ whisperModelId }), onProgress })
}

/** 요약 모델만 받는다. 온보딩 묶음에 들어가지 않는 선택 모델이다 (`references/distribution.md` 1절) */
export const downloadSummaryModel = ({ onProgress }: { onProgress: ProgressListener }) =>
  downloadAssets({ assets: [SUMMARY_MODEL_ASSET], onProgress })
