import { existsSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import {
  DEFAULT_WHISPER_MODEL_ID,
  REQUIRED_MODEL_ASSETS,
  SUMMARY_MODEL_ASSET,
  isWhisperModelId,
  whisperModelOptionOf,
  type ModelAsset,
  type ModelKey,
  type WhisperModelId
} from '@meeting-stt/models/desktop'

export type { ModelKey, WhisperModelId }

const MODEL_KEYS: ModelKey[] = ['whisper', 'vad', 'segmentation', 'embedding']

/**
 * 사용자가 온보딩에서 고른 음성 인식 모델. 앱 시작 시 설정(`stt.model`)에서 한 번 넣고,
 * 이후 모델 파일명을 정하는 곳은 이 모듈뿐이다 (`references/distribution.md`).
 */
let selectedWhisperModelId: WhisperModelId = DEFAULT_WHISPER_MODEL_ID

/** 모르는 값(예전 설정이 남은 경우)은 기본 모델로 되돌린다 */
export const setSelectedWhisperModelId = (id: unknown) => {
  selectedWhisperModelId = isWhisperModelId(id) ? id : DEFAULT_WHISPER_MODEL_ID

  return selectedWhisperModelId
}

export const getSelectedWhisperModelId = () => selectedWhisperModelId

const assetOf = (key: ModelKey): ModelAsset => {
  if (key === 'whisper') return whisperModelOptionOf(selectedWhisperModelId).asset
  if (key === 'summary') return SUMMARY_MODEL_ASSET

  return REQUIRED_MODEL_ASSETS.find((asset) => asset.key === key) as ModelAsset
}

export const modelsDir = () => path.join(app.getPath('userData'), 'models')

/** 개발 모드 전용 폴백. Phase 1 셋업 스크립트가 받아 둔 픽스처 모델을 그대로 쓴다 */
const devFallbackPath = (fileName: string) =>
  path.join(app.getAppPath(), 'scripts', 'fixtures', 'models', fileName)

/** 모델 파일 경로. 개발 모드에서 userData에 없으면 Phase 1 픽스처를 가리킨다 */
export const modelPath = (key: ModelKey) => {
  const { fileName } = assetOf(key)
  const installed = path.join(modelsDir(), fileName)
  if (existsSync(installed) || !is.dev) return installed

  const fallback = devFallbackPath(fileName)

  return existsSync(fallback) ? fallback : installed
}

/** 준비되지 않은 모델의 한국어 이름 목록 (파이프라인 시작 전 확인용) */
export const missingModelLabels = () =>
  MODEL_KEYS.filter((key) => !existsSync(modelPath(key))).map((key) => assetOf(key).label)

/** 온보딩을 건너뛰어도 되는지 — 필수 모델이 전부 있는지 */
export const isModelSetReady = () => missingModelLabels().length === 0

/**
 * 요약 모델은 필수가 아니라 따로 본다 — 없어도 녹음·회의록 생성은 그대로 되고
 * 요약 버튼만 막힌다 (references/architecture.md).
 */
export const isSummaryModelReady = () => existsSync(modelPath('summary'))

export const summaryModelLabel = () => assetOf('summary').label

/** 온보딩·설정 화면이 쓰는 설치 여부 목록. 요약 모델은 선택 모델이라 isRequired가 false다 */
export const modelInstallStates = () =>
  [...MODEL_KEYS, 'summary' as const].map((key) => {
    const asset = assetOf(key)

    return {
      key,
      label: asset.label,
      sizeBytes: asset.downloadBytes,
      isInstalled: existsSync(modelPath(key)),
      isRequired: key !== 'summary'
    }
  })
