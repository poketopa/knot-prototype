import path from 'node:path'

import {
  DEFAULT_WHISPER_MODEL_ID,
  REQUIRED_MODEL_ASSETS,
  whisperFileNameOf,
  type ModelKey
} from '@meeting-stt/models/desktop'

const SCRIPTS_DIR = __dirname

export const PROJECT_ROOT = path.resolve(SCRIPTS_DIR, '..')

// Phase 1 검증용 로컬 자산. 용량이 커서 git에 넣지 않는다 (.gitignore: scripts/fixtures/)
export const FIXTURES_DIR = path.join(SCRIPTS_DIR, 'fixtures')
export const MODELS_DIR = path.join(FIXTURES_DIR, 'models')
export const AUDIO_DIR = path.join(FIXTURES_DIR, 'audio')
export const OUTPUT_DIR = path.join(FIXTURES_DIR, 'output')
export const DOWNLOAD_TMP_DIR = path.join(MODELS_DIR, 'tmp')

export const PLATFORM_KEY = `${process.platform}-${process.arch}`

/** CI에서 다른 플랫폼 자산을 미리 받을 수 있게 플랫폼 키를 인자로 받는다 */
export const binDirOf = ({ platformKey }: { platformKey: string }) =>
  path.join(PROJECT_ROOT, 'resources', 'bin', platformKey)

export const BIN_DIR = binDirOf({ platformKey: PLATFORM_KEY })

export const WHISPER_BIN = path.join(BIN_DIR, 'whisper-cli')
export const DIARIZE_BIN = path.join(BIN_DIR, 'sherpa-onnx-offline-speaker-diarization')

// 파일명은 앱과 같은 레지스트리에서 가져온다 (src/main/models/registry.ts)
const requiredModelFileName = (key: ModelKey) =>
  (REQUIRED_MODEL_ASSETS.find((asset) => asset.key === key) ?? REQUIRED_MODEL_ASSETS[0]).fileName

export const WHISPER_MODEL = path.join(MODELS_DIR, whisperFileNameOf(DEFAULT_WHISPER_MODEL_ID))
export const VAD_MODEL = path.join(MODELS_DIR, requiredModelFileName('vad'))
export const SEGMENTATION_MODEL = path.join(MODELS_DIR, requiredModelFileName('segmentation'))
export const EMBEDDING_MODEL = path.join(MODELS_DIR, requiredModelFileName('embedding'))
