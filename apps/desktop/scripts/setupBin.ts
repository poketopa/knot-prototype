import { existsSync } from 'node:fs'
import { chmod, mkdir, symlink, unlink } from 'node:fs/promises'
import path from 'node:path'

import {
  ensureArchiveAsset,
  llamaBinaryAsset,
  sherpaBinaryAsset,
  whisperWindowsBinaryAsset
} from './assets'
import { buildWhisperFromSource } from './buildWhisper'
import { fail, info, warn } from './log'
import { DOWNLOAD_TMP_DIR, PLATFORM_KEY, binDirOf } from './paths'
import { clearQuarantine, which } from './shell'

const SUPPORTED_PLATFORMS = ['darwin-arm64', 'win32-x64']

/**
 * macOS는 Homebrew(`brew install whisper-cpp`) 설치본을 심볼릭 링크로 쓴다.
 * 실행 파일이 @rpath로 Cellar의 dylib을 참조하므로 복사하면 깨진다.
 * 배포용 동봉 빌드는 따로 확보해야 한다 (`references/distribution.md`).
 */
const linkWhisperCli = async ({ binDir }: { binDir: string }) => {
  const whisperBin = path.join(binDir, 'whisper-cli')
  if (existsSync(whisperBin)) {
    info('· whisper-cli 이미 준비됨')
    return
  }

  const systemPath = await which('whisper-cli')
  if (!systemPath) {
    fail('whisper-cli를 찾지 못했습니다. `brew install whisper-cpp` 후 다시 실행해 주세요')
  }

  await unlink(whisperBin).catch(() => undefined)
  await symlink(systemPath, whisperBin)
  warn(`whisper-cli를 시스템 설치본(${systemPath})에 링크했습니다 — 개발 전용입니다`)
}

/**
 * 로컬 요약용 llama-cli (Phase 5). 요약은 선택 기능이라 자산이 없는 플랫폼이면
 * 경고만 남기고 넘어간다 — 여기서 멈추면 STT 준비까지 막힌다.
 */
const setupLlamaCli = async ({ binDir, platformKey }: { binDir: string; platformKey: string }) => {
  try {
    await ensureArchiveAsset(llamaBinaryAsset({ binDir, platformKey }))
  } catch (caught) {
    warn(
      `llama-cli 준비 실패 — 요약 기능만 막힙니다: ${caught instanceof Error ? caught.message : String(caught)}`
    )
    return
  }

  const llamaBin = path.join(
    binDir,
    platformKey.startsWith('win32') ? 'llama-cli.exe' : 'llama-cli'
  )
  await chmod(llamaBin, 0o755)
  await clearQuarantine(llamaBin)
}

/** `--platform=win32-x64` 로 다른 플랫폼 자산을 미리 받을 수 있다 (CI·크로스 준비용) */
const platformKeyOf = (argv: string[]) =>
  argv.find((arg) => arg.startsWith('--platform='))?.split('=')[1] ?? PLATFORM_KEY

const main = async () => {
  const argv = process.argv.slice(2)
  const platformKey = platformKeyOf(argv)
  const wantsSourceBuild = argv.includes('--from-source')
  if (!SUPPORTED_PLATFORMS.includes(platformKey)) {
    fail(`아직 ${SUPPORTED_PLATFORMS.join(', ')} 만 지원합니다 (요청: ${platformKey})`)
  }

  const binDir = binDirOf({ platformKey })
  await mkdir(binDir, { recursive: true })
  await mkdir(DOWNLOAD_TMP_DIR, { recursive: true })

  info(`바이너리를 ${binDir} 에 준비합니다.`)

  if (platformKey === 'darwin-arm64') {
    // 배포 빌드는 --from-source로 정적 whisper-cli를 만든다. Homebrew 링크는 개발 전용이다
    if (wantsSourceBuild) await buildWhisperFromSource({ binDir })
    else await linkWhisperCli({ binDir })
  } else {
    await ensureArchiveAsset(whisperWindowsBinaryAsset({ binDir }))
  }

  await ensureArchiveAsset(sherpaBinaryAsset({ binDir, platformKey }))

  const diarizeBin = path.join(
    binDir,
    platformKey.startsWith('win32')
      ? 'sherpa-onnx-offline-speaker-diarization.exe'
      : 'sherpa-onnx-offline-speaker-diarization'
  )
  await chmod(diarizeBin, 0o755)
  await clearQuarantine(diarizeBin)

  await setupLlamaCli({ binDir, platformKey })

  info('바이너리 준비 완료')
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error))
})
