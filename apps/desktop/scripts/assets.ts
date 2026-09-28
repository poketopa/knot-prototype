import { existsSync } from 'node:fs'
import { copyFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'

import {
  REQUIRED_MODEL_ASSETS,
  SUMMARY_MODEL_ASSET,
  WHISPER_MODEL_OPTIONS,
  type ModelAsset
} from '@meeting-stt/models/desktop'
import { downloadFile } from './download'
import { info } from './log'
import { extractArchive } from './shell'
import { DOWNLOAD_TMP_DIR, MODELS_DIR } from './paths'

interface DirectAsset {
  label: string
  url: string
  sha256: string
  destPath: string
}

interface ArchiveEntry {
  /** 아카이브 내부 경로 */
  entry: string
  destPath: string
}

interface ArchiveAsset {
  label: string
  url: string
  sha256: string
  archiveName: string
  entries: ArchiveEntry[]
}

const SHERPA_VERSION = 'v1.13.6'
const WHISPER_WINDOWS_RELEASE = 'b4938'

/** 빌드 번호를 고정한다. 최신 빌드를 자동 추적하면 체크섬이 매일 바뀐다 */
const LLAMA_RELEASE = 'b10622'

/**
 * 모델 목록은 앱과 같은 레지스트리(`src/main/models/registry.ts`)에서 가져온다.
 * 스크립트 쪽 형태(destPath 포함)로만 바꿔 준다 (`references/distribution.md`).
 */
const toScriptAsset = (asset: ModelAsset): DirectAsset | ArchiveAsset => {
  const destPath = path.join(MODELS_DIR, asset.fileName)
  if (asset.kind === 'direct') {
    return { label: asset.label, url: asset.url, sha256: asset.sha256, destPath }
  }

  return {
    label: asset.label,
    url: asset.url,
    sha256: asset.sha256,
    archiveName: asset.archiveName,
    entries: [{ entry: asset.entry, destPath }]
  }
}

const isArchive = (asset: DirectAsset | ArchiveAsset): asset is ArchiveAsset => 'entries' in asset

interface ModelAssetsParams {
  wantsAll: boolean
  /** 요약 모델은 2.5GB라 기본으로 받지 않는다 (`--summary`) */
  wantsSummary?: boolean
}

/** 기본 모델(권장 whisper + 필수 모델). `--all`이면 비교용 whisper 모델도 함께 */
export const modelAssetsOf = ({ wantsAll, wantsSummary = false }: ModelAssetsParams) => {
  const whisperOptions = wantsAll ? WHISPER_MODEL_OPTIONS : WHISPER_MODEL_OPTIONS.slice(0, 1)
  const assets = [
    ...whisperOptions.map((option) => option.asset),
    ...REQUIRED_MODEL_ASSETS,
    ...(wantsSummary ? [SUMMARY_MODEL_ASSET] : [])
  ].map(toScriptAsset)

  return {
    directAssets: assets.filter((asset): asset is DirectAsset => !isArchive(asset)),
    archiveAssets: assets.filter(isArchive)
  }
}

const SHERPA_ARCHIVES: Record<string, { root: string; sha256: string; libNames: string[] }> = {
  'darwin-arm64': {
    root: `sherpa-onnx-${SHERPA_VERSION}-osx-arm64-shared-no-tts`,
    sha256: 'a188765a80094f8505b7ba02b6b906b6bb0dd42d0281822e6c11cdeba4120b24',
    libNames: ['libonnxruntime.dylib', 'libsherpa-onnx-c-api.dylib', 'libsherpa-onnx-cxx-api.dylib']
  },
  'win32-x64': {
    root: `sherpa-onnx-${SHERPA_VERSION}-win-x64-shared-MD-Release-no-tts`,
    sha256: '071d6641efd737a1f60de48c9c4cd596f78d5b0980815e8ad3798c95785d2b26',
    libNames: ['sherpa-onnx-c-api.dll', 'sherpa-onnx-cxx-api.dll']
  }
}

/** Windows는 실행 파일과 같은 폴더에 있어야 로드되는 DLL이 bin/에도 있다 */
const WINDOWS_SHERPA_BIN_DLLS = ['onnxruntime.dll', 'onnxruntime_providers_shared.dll']

/**
 * 플랫폼별 sherpa-onnx 실행 파일 아카이브.
 * 바이너리와 동적 라이브러리는 같은 폴더에 둬야 macOS의 @loader_path와 Windows의 DLL 검색이 맞는다.
 */
export const sherpaBinaryAsset = ({
  binDir,
  platformKey
}: {
  binDir: string
  platformKey: string
}): ArchiveAsset => {
  const archive = SHERPA_ARCHIVES[platformKey]
  if (!archive) throw new Error(`sherpa-onnx 자산이 정의되지 않은 플랫폼입니다: ${platformKey}`)

  const exeSuffix = platformKey.startsWith('win32') ? '.exe' : ''
  const binDlls = platformKey.startsWith('win32') ? WINDOWS_SHERPA_BIN_DLLS : []

  return {
    label: `sherpa-onnx ${SHERPA_VERSION} (${platformKey})`,
    url: `https://github.com/k2-fsa/sherpa-onnx/releases/download/${SHERPA_VERSION}/${archive.root}.tar.bz2`,
    sha256: archive.sha256,
    archiveName: `${archive.root}.tar.bz2`,
    entries: [
      {
        entry: `${archive.root}/bin/sherpa-onnx-offline-speaker-diarization${exeSuffix}`,
        destPath: path.join(binDir, `sherpa-onnx-offline-speaker-diarization${exeSuffix}`)
      },
      ...binDlls.map((name) => ({
        entry: `${archive.root}/bin/${name}`,
        destPath: path.join(binDir, name)
      })),
      ...archive.libNames.map((name) => ({
        entry: `${archive.root}/lib/${name}`,
        destPath: path.join(binDir, name)
      }))
    ]
  }
}

/** whisper-cli.exe가 로드하는 DLL. ggml-cpu-*는 CPU 명령어 집합별로 런타임에 하나가 선택된다 */
const WHISPER_WINDOWS_DLLS = [
  'whisper.dll',
  'ggml.dll',
  'ggml-base.dll',
  'ggml-blas.dll',
  'libopenblas.dll',
  'ggml-cpu-alderlake.dll',
  'ggml-cpu-cannonlake.dll',
  'ggml-cpu-cascadelake.dll',
  'ggml-cpu-haswell.dll',
  'ggml-cpu-icelake.dll',
  'ggml-cpu-sandybridge.dll',
  'ggml-cpu-skylakex.dll',
  'ggml-cpu-sse42.dll',
  'ggml-cpu-x64.dll'
]

/**
 * Windows용 whisper.cpp는 CPU+OpenBLAS 빌드를 동봉한다.
 * 공식 릴리스에 Vulkan 빌드가 없고 cuBLAS 빌드는 257MB/640MB라 설치 파일에 넣지 않는다
 * (`references/distribution.md`).
 */
export const whisperWindowsBinaryAsset = ({ binDir }: { binDir: string }): ArchiveAsset => {
  const archiveName = 'whisper-blas-bin-x64.zip'

  return {
    label: `whisper.cpp ${WHISPER_WINDOWS_RELEASE} (win32-x64, CPU+BLAS)`,
    url: `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_WINDOWS_RELEASE}/${archiveName}`,
    sha256: '78568aa80b361382cb303438a7be3b05669651f2ca8258910394679e049d26ea',
    archiveName,
    entries: [
      { entry: 'Release/whisper-cli.exe', destPath: path.join(binDir, 'whisper-cli.exe') },
      ...WHISPER_WINDOWS_DLLS.map((name) => ({
        entry: `Release/${name}`,
        destPath: path.join(binDir, name)
      }))
    ]
  }
}

/**
 * Windows CPU 빌드가 실행 시점에 골라 쓰는 ggml 백엔드. 임포트 테이블에 없어서
 * 의존성 추적으로는 안 잡히므로 whisper와 같이 전부 동봉한다.
 */
const LLAMA_WINDOWS_CPU_DLLS = [
  'ggml-cpu-alderlake.dll',
  'ggml-cpu-cannonlake.dll',
  'ggml-cpu-cascadelake.dll',
  'ggml-cpu-cooperlake.dll',
  'ggml-cpu-haswell.dll',
  'ggml-cpu-icelake.dll',
  'ggml-cpu-ivybridge.dll',
  'ggml-cpu-piledriver.dll',
  'ggml-cpu-sandybridge.dll',
  'ggml-cpu-sapphirerapids.dll',
  'ggml-cpu-skylakex.dll',
  'ggml-cpu-sse42.dll',
  'ggml-cpu-x64.dll',
  'ggml-cpu-zen4.dll'
]

const LLAMA_ENTRIES: Record<
  string,
  { root: string; sha256: string; archiveName: string; files: string[] }
> = {
  'darwin-arm64': {
    root: `llama-${LLAMA_RELEASE}`,
    archiveName: `llama-${LLAMA_RELEASE}-bin-macos-arm64.tar.gz`,
    sha256: 'c0116ec9957477a9c77e68d3cf31e79f9aede1a9210861c7c09d74acc3e9c3cf',
    files: [
      'llama-cli',
      'libllama-cli-impl.dylib',
      'libllama-server-impl.dylib',
      'libmtmd.0.dylib',
      'libllama-common.0.dylib',
      'libllama.0.dylib',
      'libggml.0.dylib',
      'libggml-cpu.0.dylib',
      'libggml-blas.0.dylib',
      'libggml-metal.0.dylib',
      'libggml-rpc.0.dylib',
      'libggml-base.0.dylib'
    ]
  },
  // Windows 릴리스는 파일이 아카이브 최상위에 있어 root가 없다. GPU 빌드는 드라이버가 없으면
  // 못 뜨고 설치 파일만 키우므로 whisper와 같이 CPU 빌드를 쓴다 (`references/distribution.md` 10.2절)
  'win32-x64': {
    root: '',
    archiveName: `llama-${LLAMA_RELEASE}-bin-win-cpu-x64.zip`,
    sha256: '0f016b001d00a0cc25b955a5ae5eb3ce57a0b16adaa9142f8a3c3269e83fce0a',
    files: [
      'llama-cli.exe',
      'llama-cli-impl.dll',
      // llama-server를 쓰지 않는데도 llama-cli-impl이 직접 링크한다 (macOS와 같다)
      'llama-server-impl.dll',
      'llama-common.dll',
      'llama.dll',
      'mtmd.dll',
      'ggml.dll',
      'ggml-base.dll',
      // ggml-base가 링크하는 OpenMP 런타임
      'libomp.dll',
      ...LLAMA_WINDOWS_CPU_DLLS
    ]
  }
}

/**
 * llama.cpp 실행 파일과 의존 라이브러리. macOS는 rpath가 `@loader_path`라 같은 폴더에 두면 그대로 동작한다.
 * 릴리스에는 도구가 60개 들어 있지만 요약에 필요한 `llama-cli`와 그 의존 라이브러리만 꺼낸다
 * (`references/architecture.md`).
 */
export const llamaBinaryAsset = ({
  binDir,
  platformKey
}: {
  binDir: string
  platformKey: string
}): ArchiveAsset => {
  const archive = LLAMA_ENTRIES[platformKey]
  if (!archive) throw new Error(`llama.cpp 자산이 정의되지 않은 플랫폼입니다: ${platformKey}`)

  return {
    label: `llama.cpp ${LLAMA_RELEASE} (${platformKey})`,
    url: `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_RELEASE}/${archive.archiveName}`,
    sha256: archive.sha256,
    archiveName: archive.archiveName,
    entries: archive.files.map((name) => ({
      entry: archive.root ? `${archive.root}/${name}` : name,
      destPath: path.join(binDir, name)
    }))
  }
}

export const ensureDirectAsset = async (asset: DirectAsset) => {
  await downloadFile({
    url: asset.url,
    destPath: asset.destPath,
    sha256: asset.sha256,
    label: asset.label
  })
}

export const ensureArchiveAsset = async (asset: ArchiveAsset) => {
  if (asset.entries.every((it) => existsSync(it.destPath))) {
    info(`· ${asset.label} 이미 준비됨`)
    return
  }

  const archivePath = path.join(DOWNLOAD_TMP_DIR, asset.archiveName)
  await downloadFile({
    url: asset.url,
    destPath: archivePath,
    sha256: asset.sha256,
    label: asset.label
  })

  const extractDir = path.join(DOWNLOAD_TMP_DIR, `${asset.archiveName}.extracted`)
  await rm(extractDir, { recursive: true, force: true })
  await mkdir(extractDir, { recursive: true })
  await extractArchive({ archivePath, destDir: extractDir })

  for (const { entry, destPath } of asset.entries) {
    await mkdir(path.dirname(destPath), { recursive: true })
    await copyFile(path.join(extractDir, entry), destPath)
  }

  await rm(extractDir, { recursive: true, force: true })
  info(`· ${asset.label} 배치 완료`)
}
