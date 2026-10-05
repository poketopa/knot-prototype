// 측정용 음성을 한 번만 만들어 모든 장비에 같은 파일을 나눠 준다.
// 사용: pnpm --filter meeting-stt exec tsx scripts/bench/prepare.ts [--out=폴더] <음성 파일 또는 폴더...>
// macOS의 afconvert로 16kHz mono 16bit WAV로 바꾸고, 앱과 같은 음량 정규화를 한 뒤 manifest.json을 쓴다.
import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { normalizeWavFile, readWavPcm } from '../../src/main/pipeline/normalize'
import { sha256Of } from '../download'
import { fail, info } from '../log'
import { SAMPLE_RATE_HZ, writeWav } from '../wav'
import { BENCH_AUDIO_DIR, parseArgs } from './args'

const execFileAsync = promisify(execFile)

const AUDIO_EXTENSIONS = new Set([
  '.wav',
  '.m4a',
  '.mp3',
  '.aac',
  '.aif',
  '.aiff',
  '.caf',
  '.flac',
  '.mp4'
])
const PROBE_SEC = 15
const BYTES_PER_SAMPLE = 2

export interface BenchInput {
  id: string
  file: string
  durationSec: number
  sha256: string
  /** 원본 파일 이름. 결과 해석용이며 다른 장비에는 필요 없다 */
  source: string
}

export interface BenchManifest {
  createdAt: string
  sampleRate: number
  inputs: BenchInput[]
  /** 백엔드(GPU 사용 여부) 확인용 짧은 조각 */
  probe: { file: string; durationSec: number; sha256: string }
}

const collectFiles = async (targets: string[]) => {
  const files: string[] = []
  for (const target of targets) {
    if (!existsSync(target)) fail(`${target} 이(가) 없습니다`)
    if (statSync(target).isDirectory()) {
      const names = (await readdir(target)).sort()
      files.push(
        ...names
          .filter((name) => AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase()))
          .map((name) => path.join(target, name))
      )
    } else {
      files.push(target)
    }
  }
  return files
}

/** 앱 녹음과 같은 형식(16kHz mono 16bit)으로 바꾼다. afconvert는 macOS 기본 도구다 */
const toAppWav = async ({ inputPath, outputPath }: { inputPath: string; outputPath: string }) => {
  if (process.platform !== 'darwin') {
    fail('prepare는 macOS에서 실행합니다. 만든 폴더를 다른 장비로 복사해 쓰세요')
  }
  await execFileAsync('afconvert', [
    '-f',
    'WAVE',
    '-d',
    `LEI16@${SAMPLE_RATE_HZ}`,
    '-c',
    '1',
    inputPath,
    outputPath
  ])
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  const outDir = path.resolve(args.text('out') ?? BENCH_AUDIO_DIR)
  const files = await collectFiles(args.positionals)
  if (files.length === 0) fail('음성 파일 또는 폴더를 주세요')

  await mkdir(outDir, { recursive: true })
  const tmpDir = path.join(outDir, 'tmp')
  await mkdir(tmpDir, { recursive: true })

  const inputs: BenchInput[] = []
  for (const [index, inputPath] of files.entries()) {
    const id = `a${String(index + 1).padStart(2, '0')}`
    const converted = path.join(tmpDir, `${id}.wav`)
    const file = `${id}.wav`

    await toAppWav({ inputPath, outputPath: converted })
    const result = await normalizeWavFile({
      inputPath: converted,
      outputPath: path.join(outDir, file)
    })
    const { pcm, sampleRate } = readWavPcm(await readFile(path.join(outDir, file)))
    const durationSec = pcm.length / sampleRate

    inputs.push({
      id,
      file,
      durationSec,
      sha256: await sha256Of(path.join(outDir, file)),
      source: path.basename(inputPath)
    })
    info(
      `${id} ← ${path.basename(inputPath)} · ${(durationSec / 60).toFixed(1)}분 · 게인 ${result.gainDb.toFixed(1)} dB`
    )
  }

  const first = readWavPcm(await readFile(path.join(outDir, inputs[0].file)))
  const probePcm = first.pcm.subarray(0, Math.min(first.pcm.length, PROBE_SEC * SAMPLE_RATE_HZ))
  const probeFile = 'probe.wav'
  await writeWav({
    filePath: path.join(outDir, probeFile),
    pcm: Buffer.from(probePcm.buffer, probePcm.byteOffset, probePcm.length * BYTES_PER_SAMPLE)
  })

  const manifest: BenchManifest = {
    createdAt: new Date().toISOString(),
    sampleRate: SAMPLE_RATE_HZ,
    inputs,
    probe: {
      file: probeFile,
      durationSec: probePcm.length / SAMPLE_RATE_HZ,
      sha256: await sha256Of(path.join(outDir, probeFile))
    }
  }
  await writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await rm(tmpDir, { recursive: true, force: true })

  const totalMin = inputs.reduce((sum, input) => sum + input.durationSec, 0) / 60
  info(`\n${inputs.length}개 · 총 ${totalMin.toFixed(1)}분 → ${outDir}/manifest.json`)
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error))
})
