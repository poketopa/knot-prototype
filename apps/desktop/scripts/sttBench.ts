// STT만 돌려 정답 전사본과의 CER·반복 환각·처리 시간을 잰다. 화자 분리는 하지 않는다.
// 사용: pnpm --filter meeting-stt exec tsx scripts/sttBench.ts <audio.wav> [--tag=이름] [--model=경로]
//       [--bin=whisper-cli 경로] [--ref=정답.txt] [--extra="-mc 0 -sns"] [--no-vad]
// 정답은 기본으로 scripts/fixtures/reference/<오디오 이름>.txt 를 쓴다.
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { SttSegment } from '@shared/types'

import { threadPlan } from '../src/main/bin/threads'
import { normalizeWavFile } from '../src/main/pipeline/normalize'
import {
  buildWhisperArgs,
  parseWhisperOutput,
  parseWhisperProgress
} from '../src/main/pipeline/whisper'
import { computeCer, normalizeForCer } from './cer'
import { fail, info } from './log'
import { FIXTURES_DIR, OUTPUT_DIR, VAD_MODEL, WHISPER_BIN, WHISPER_MODEL } from './paths'
import { run } from './shell'

const REFERENCE_DIR = path.join(FIXTURES_DIR, 'reference')
const RESULTS_PATH = path.join(OUTPUT_DIR, 'sttBench.tsv')
const PROGRESS_STEP_PERCENT = 10
const MS_PER_SEC = 1000
const PERCENT = 100

interface BenchOptions {
  audioPath: string
  tag: string
  modelPath: string
  binPath: string
  referencePath: string
  extraArgs: string[]
  useVad: boolean
}

const parseOptions = (argv: string[]): BenchOptions => {
  const audioPath = argv.find((arg) => !arg.startsWith('--'))
  if (!audioPath) return fail('오디오 경로를 주세요')

  const valueOf = (name: string) => {
    const prefix = `--${name}=`
    return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
  }
  const baseName = path.basename(audioPath, '.wav')

  return {
    audioPath,
    tag: valueOf('tag') ?? 'baseline',
    modelPath: valueOf('model') ?? WHISPER_MODEL,
    binPath: valueOf('bin') ?? WHISPER_BIN,
    referencePath: valueOf('ref') ?? path.join(REFERENCE_DIR, `${baseName}.txt`),
    extraArgs: (valueOf('extra') ?? '').split(' ').filter(Boolean),
    useVad: !argv.includes('--no-vad')
  }
}

/** 정규화본은 입력이 같으면 결과도 같으므로 한 번 만들어 재사용한다 */
const ensureNormalized = async (audioPath: string) => {
  const normalizedPath = path.join(OUTPUT_DIR, `${path.basename(audioPath, '.wav')}.norm.wav`)
  if (existsSync(normalizedPath)) return normalizedPath

  const result = await normalizeWavFile({ inputPath: audioPath, outputPath: normalizedPath })
  info(
    `정규화: 발화 RMS ${result.speechRmsDb.toFixed(1)} dBFS → 게인 ${result.gainDb.toFixed(1)} dB`
  )
  return normalizedPath
}

/**
 * 직전 세그먼트와 글자가 똑같은 세그먼트를 반복 환각으로 본다.
 * 사람이 같은 말을 연달아 할 때(네, 네)도 걸리지만 그 길이는 몇 초라 수백 초짜리 환각과 구분된다.
 */
const measureRepetition = (segments: SttSegment[]) =>
  segments.reduce(
    (acc, segment, index) => {
      const text = normalizeForCer(segment.text)
      const isRepeat =
        index > 0 && text !== '' && text === normalizeForCer(segments[index - 1].text)
      if (!isRepeat) return acc
      return { count: acc.count + 1, seconds: acc.seconds + (segment.end - segment.start) }
    },
    { count: 0, seconds: 0 }
  )

const runWhisper = async ({ options, audioPath }: { options: BenchOptions; audioPath: string }) => {
  const outputPath = path.join(
    OUTPUT_DIR,
    `${path.basename(options.audioPath, '.wav')}.${options.tag}`
  )
  const { stt } = await threadPlan()
  const args = [
    ...buildWhisperArgs({
      modelPath: options.modelPath,
      audioPath,
      outputPath,
      threads: stt,
      vadModelPath: options.useVad ? VAD_MODEL : undefined
    }),
    ...options.extraArgs
  ]

  let lastReported = -PROGRESS_STEP_PERCENT
  const startedAt = performance.now()
  const result = await run({
    command: options.binPath,
    args,
    onStderrLine: (line) => {
      const percent = parseWhisperProgress(line)
      if (percent === null || percent < lastReported + PROGRESS_STEP_PERCENT) return
      lastReported = percent
      info(`  STT ${percent}%`)
    }
  })
  if (result.code !== 0) {
    fail(`whisper-cli 비정상 종료 (${result.code})\n${result.stderr.slice(-800)}`)
  }

  const segments = parseWhisperOutput(await readFile(`${outputPath}.json`))
  const text = segments.map((segment) => segment.text).join('\n')
  await writeFile(`${outputPath}.txt`, `${text}\n`, 'utf-8')

  return { segments, text, outputPath, elapsedSec: (performance.now() - startedAt) / MS_PER_SEC }
}

const main = async () => {
  const options = parseOptions(process.argv.slice(2))
  for (const target of [
    options.audioPath,
    options.binPath,
    options.modelPath,
    options.referencePath
  ]) {
    if (!existsSync(target)) fail(`${target} 이(가) 없습니다`)
  }
  await mkdir(OUTPUT_DIR, { recursive: true })

  info(`입력 ${options.audioPath} · 태그 ${options.tag} · 모델 ${path.basename(options.modelPath)}`)
  info(`바이너리 ${options.binPath} · 추가 인자 ${options.extraArgs.join(' ') || '없음'}`)

  const audioPath = await ensureNormalized(options.audioPath)
  const stt = await runWhisper({ options, audioPath })
  const score = computeCer({
    hypothesis: stt.text,
    reference: await readFile(options.referencePath, 'utf-8')
  })
  const repetition = measureRepetition(stt.segments)

  const cerPercent = (score.cer * PERCENT).toFixed(2)
  info('')
  info(
    `CER ${cerPercent}% (치환 ${score.substitutions} · 삭제 ${score.deletions} · 삽입 ${score.insertions})`
  )
  info(`글자 수 정답 ${score.referenceChars} · 인식 ${score.hypothesisChars}`)
  info(`반복 세그먼트 ${repetition.count}개 · ${repetition.seconds.toFixed(0)}초`)
  info(`처리 시간 ${stt.elapsedSec.toFixed(1)}초`)
  info(`결과 ${stt.outputPath}.txt`)

  if (!existsSync(RESULTS_PATH)) {
    await writeFile(
      RESULTS_PATH,
      'date\taudio\ttag\tmodel\textra\tcer%\tsub\tdel\tins\trefChars\thypChars\trepeatSegs\trepeatSec\tsttSec\n'
    )
  }
  await appendFile(
    RESULTS_PATH,
    [
      new Date().toISOString(),
      path.basename(options.audioPath),
      options.tag,
      path.basename(options.modelPath),
      options.extraArgs.join(' '),
      cerPercent,
      score.substitutions,
      score.deletions,
      score.insertions,
      score.referenceChars,
      score.hypothesisChars,
      repetition.count,
      repetition.seconds.toFixed(0),
      stt.elapsedSec.toFixed(1)
    ].join('\t') + '\n'
  )
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error))
})
