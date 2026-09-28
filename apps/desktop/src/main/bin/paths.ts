import { existsSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'

const PLATFORM_KEY = `${process.platform}-${process.arch}`
const EXE_SUFFIX = process.platform === 'win32' ? '.exe' : ''

/**
 * Windows 가속 빌드 폴더. 우선순위 순서대로 보고 먼저 있는 것을 쓴다.
 * GPU를 조회하지 않고 폴더 존재만 본다 — 폴더를 채우는 쪽(설치 파일·선택 다운로드)이 이미 판단했다
 * (`references/distribution.md`).
 */
const WINDOWS_VARIANT_DIRS = ['cuda']

/**
 * 동봉 바이너리 위치. 패키징하면 asar 밖(app.asar.unpacked)으로 풀리므로 경로가 달라진다.
 * 경로 해석은 이 파일에서만 한다 (references/architecture.md).
 */
const platformBinDir = () =>
  is.dev
    ? path.join(app.getAppPath(), 'resources', 'bin', PLATFORM_KEY)
    : path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'bin', PLATFORM_KEY)

const binDir = () => {
  const root = platformBinDir()
  if (process.platform !== 'win32') return root

  const variant = WINDOWS_VARIANT_DIRS.find((name) => existsSync(path.join(root, name)))

  return variant ? path.join(root, variant) : root
}

export const whisperBinPath = () => path.join(binDir(), `whisper-cli${EXE_SUFFIX}`)

export const diarizeBinPath = () =>
  path.join(binDir(), `sherpa-onnx-offline-speaker-diarization${EXE_SUFFIX}`)

/** 로컬 요약용 llama.cpp 실행 파일 (Phase 5). 의존 dylib은 같은 폴더에 있어야 한다 */
export const llamaBinPath = () => path.join(binDir(), `llama-cli${EXE_SUFFIX}`)
