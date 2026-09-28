import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { info, warn } from './log'
import { FIXTURES_DIR } from './paths'
import { clearQuarantine, run } from './shell'

/**
 * Phase 1에서 측정·검증한 버전. 올리려면 `docs/phase1-results.md`의 항목을 다시 재고,
 * 특히 `--vad` + 토큰 타임스탬프 동작이 그대로인지 확인해야 한다 (`references/pitfalls.md`).
 */
const WHISPER_TAG = 'v1.8.4'
const REPOSITORY_URL = 'https://github.com/ggml-org/whisper.cpp'
const SOURCE_DIR = path.join(FIXTURES_DIR, 'build', 'whisper.cpp')
const BUILD_DIR = path.join(SOURCE_DIR, 'build')
const STDERR_TAIL_CHARS = 1500

const runStep = async ({
  label,
  command,
  args
}: {
  label: string
  command: string
  args: string[]
}) => {
  info(`· ${label}`)
  const { code, stderr } = await run({ command, args })
  if (code !== 0) {
    throw new Error(`${label} 실패 (코드 ${code})\n${stderr.slice(-STDERR_TAIL_CHARS)}`)
  }
}

const cloneSource = async () => {
  if (existsSync(SOURCE_DIR)) {
    info(`· whisper.cpp ${WHISPER_TAG} 소스 이미 준비됨`)
    return
  }

  await mkdir(path.dirname(SOURCE_DIR), { recursive: true })
  await runStep({
    label: `whisper.cpp ${WHISPER_TAG} 내려받기`,
    command: 'git',
    args: ['clone', '--depth', '1', '--branch', WHISPER_TAG, REPOSITORY_URL, SOURCE_DIR]
  })
}

/**
 * 배포용 whisper-cli를 소스에서 빌드해 동봉한다.
 * Homebrew 설치본은 Cellar의 dylib을 @rpath로 참조해서 다른 컴퓨터에서 실행되지 않는다.
 * 정적 링크(`BUILD_SHARED_LIBS=OFF`)와 Metal 셰이더 내장(`GGML_METAL_EMBED_LIBRARY=ON`)으로
 * 파일 하나만 복사하면 되게 만든다 (`references/distribution.md`).
 */
export const buildWhisperFromSource = async ({ binDir }: { binDir: string }) => {
  await cloneSource()

  await runStep({
    label: 'cmake 구성',
    command: 'cmake',
    args: [
      '-S',
      SOURCE_DIR,
      '-B',
      BUILD_DIR,
      '-DCMAKE_BUILD_TYPE=Release',
      '-DBUILD_SHARED_LIBS=OFF',
      '-DGGML_METAL=ON',
      '-DGGML_METAL_EMBED_LIBRARY=ON',
      '-DWHISPER_BUILD_TESTS=OFF',
      '-DWHISPER_BUILD_SERVER=OFF',
      '-DWHISPER_BUILD_EXAMPLES=ON'
    ]
  })

  await runStep({
    label: 'whisper-cli 빌드',
    command: 'cmake',
    args: [
      '--build',
      BUILD_DIR,
      '--config',
      'Release',
      '--target',
      'whisper-cli',
      '-j',
      String(os.cpus().length)
    ]
  })

  const builtBin = path.join(BUILD_DIR, 'bin', 'whisper-cli')
  if (!existsSync(builtBin)) throw new Error(`빌드 결과를 찾지 못했습니다: ${builtBin}`)

  const destBin = path.join(binDir, 'whisper-cli')
  await mkdir(binDir, { recursive: true })
  // 개발용 심볼릭 링크가 남아 있으면 복사가 링크를 따라가 Homebrew 설치본을 덮어쓴다
  await rm(destBin, { force: true })
  await copyFile(builtBin, destBin)
  await chmod(destBin, 0o755)
  await clearQuarantine(destBin)

  // 동봉본이 시스템 dylib 외에 무엇을 참조하는지 남긴다 — Homebrew 경로가 보이면 배포할 수 없다
  const { stdout } = await run({ command: 'otool', args: ['-L', destBin] })
  const externalLibs = stdout
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(' ')[0])
    .filter((lib) => lib && !lib.startsWith('/usr/lib/') && !lib.startsWith('/System/'))

  if (externalLibs.length) {
    warn(`동봉본이 시스템 밖 라이브러리를 참조합니다: ${externalLibs.join(', ')}`)
  } else {
    info('· 정적 링크 확인 (시스템 라이브러리만 참조)')
  }

  info(`whisper-cli ${WHISPER_TAG} 동봉 빌드 완료`)
}
