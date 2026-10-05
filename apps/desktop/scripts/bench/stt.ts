// E3: 장비별 STT 처리 시간·메모리·전력 측정. 앱과 같은 whisper-cli 인자(VAD 포함)로 실행한다.
// 사용: pnpm --filter meeting-stt exec tsx scripts/bench/stt.ts --machine=macmini [옵션]
//   --audio=폴더            prepare가 만든 폴더 (기본 scripts/fixtures/bench/audio)
//   --models=turbo-q5,large-v3-q5   WHISPER_MODEL_OPTIONS의 id
//   --inputs=a01,a02        일부 입력만 (기본 전부)
//   --repeats=3 --idle-sec=60 --cooldown-sec=20
//   --bin=whisper-cli 경로  --models-dir=모델 폴더
//   --expect-backend=metal|cuda|cpu   (기본: macOS metal, Windows cuda, --no-gpu면 cpu)
//   --no-gpu                GPU를 끄고 CPU만 사용 (E1)
//   --lhm-url=http://localhost:8085/data.json   Windows CPU 전력 (선택)
//   --quick                 설치 확인용. probe 조각만 1회
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { WHISPER_MODEL_OPTIONS } from '@meeting-stt/models/desktop'

import { threadPlan } from '../../src/main/bin/threads'
import {
  buildWhisperArgs,
  parseWhisperOutput,
  parseWhisperProgress
} from '../../src/main/pipeline/whisper'
import { sha256Of } from '../download'
import { fail, info, warn } from '../log'
import { MODELS_DIR, VAD_MODEL } from '../paths'
import {
  BENCH_AUDIO_DIR,
  BENCH_RESULTS_DIR,
  DEFAULT_WHISPER_BIN,
  parseArgs,
  sleep,
  stampOf
} from './args'
import { collectEnv } from './env'
import { measureCommand } from './measure'
import { detectWhisperBackend, extraWhOf, type PowerSample, statOf } from './parse'
import { type PowerSampler, primaryPowerSources, startPowerSampler } from './power'
import type { BenchInput, BenchManifest } from './prepare'

const MS_PER_SEC = 1000
const SEC_PER_HOUR = 3600
const PROGRESS_STEP_PERCENT = 25
const QUICK_IDLE_SEC = 5
const QUICK_COOLDOWN_SEC = 2

export const RUN_COLUMNS = [
  'date',
  'experiment',
  'machine',
  'engine',
  'backend',
  'model',
  'input_id',
  'input_min',
  'seq',
  'run',
  'wall_sec',
  'rtf',
  'max_rss_mb',
  'peak_footprint_mb',
  'vram_peak_mb',
  'sys_ram_peak_mb',
  'swap_growth_mb',
  'power_scope',
  'idle_w',
  'avg_w',
  'max_w',
  'soc_avg_w',
  'extra_wh',
  'extra_wh_per_audio_h',
  'exit_code',
  'started_at',
  'ended_at'
] as const

type RunRow = Record<(typeof RUN_COLUMNS)[number], string | number | null>

const csvLine = (values: (string | number | null)[]) =>
  values.map((value) => (value === null ? '' : String(value))).join(',') + '\n'

const fixed = (value: number | null | undefined, digits: number) =>
  value === null || value === undefined ? null : Number(value.toFixed(digits))

const modelFileOf = (id: string) => {
  const option = WHISPER_MODEL_OPTIONS.find((candidate) => candidate.id === id)
  if (!option)
    fail(`모르는 모델 id입니다: ${id} (가능: ${WHISPER_MODEL_OPTIONS.map((o) => o.id).join(', ')})`)
  return option.asset.fileName
}

/** 다른 장비로 복사한 음성이 같은 파일인지 확인한다. 다르면 장비 간 비교가 무의미하다 */
const verifyInputs = async ({ audioDir, inputs }: { audioDir: string; inputs: BenchInput[] }) => {
  for (const input of inputs) {
    const filePath = path.join(audioDir, input.file)
    if (!existsSync(filePath)) fail(`${filePath} 이(가) 없습니다`)
    if ((await sha256Of(filePath)) !== input.sha256)
      fail(`${input.file}의 sha256이 manifest와 다릅니다`)
  }
}

/** 구간 동안의 대표 전력과 출처별 통계 */
const powerOf = ({
  sampler,
  idle,
  from,
  to
}: {
  sampler: PowerSampler
  idle: Map<string, number>
  from: number
  to: number
}) => {
  const primary = primaryPowerSources(sampler.sources)
  const perSource = primary.sources.map((source) => ({
    source,
    stat: statOf({ samples: sampler.samples, source, metric: 'power_w', from, to }),
    idleW: idle.get(`${source}:power_w`) ?? null
  }))
  const isComplete =
    perSource.length > 0 && perSource.every((item) => item.stat && item.idleW !== null)
  if (!isComplete)
    return { scope: primary.scope, idleW: null, avgW: null, maxW: null, extraWh: null }

  const idleW = perSource.reduce((sum, item) => sum + (item.idleW as number), 0)
  const avgW = perSource.reduce((sum, item) => sum + (item.stat?.avg ?? 0), 0)
  // 출처마다 샘플 시각이 달라 최댓값은 출처별 최댓값의 합(상한)으로 둔다
  const maxW = perSource.reduce((sum, item) => sum + (item.stat?.max ?? 0), 0)

  return {
    scope: primary.scope,
    idleW,
    avgW,
    maxW,
    extraWh: extraWhOf({ avgW, idleW, durationMs: to - from })
  }
}

const idleBaseline = ({
  samples,
  from,
  to
}: {
  samples: PowerSample[]
  from: number
  to: number
}) => {
  const baseline = new Map<string, number>()
  const keys = new Set(samples.map((s) => `${s.source}:${s.metric}`))
  for (const key of keys) {
    const [source, metric] = key.split(':')
    const stat = statOf({ samples, source, metric, from, to })
    if (stat) baseline.set(key, stat.avg)
  }
  return baseline
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  const machine =
    args.text('machine') ?? fail('--machine=이름 이 필요합니다 (예: macmini, macbook, desktop)')
  const isQuick = args.has('quick')
  const isNoGpu = args.has('no-gpu')
  const audioDir = path.resolve(args.text('audio') ?? BENCH_AUDIO_DIR)
  const binPath = path.resolve(args.text('bin') ?? DEFAULT_WHISPER_BIN)
  const modelsDir = path.resolve(args.text('models-dir') ?? MODELS_DIR)
  const modelIds =
    args.list('models').length > 0 ? args.list('models') : ['turbo-q5', 'large-v3-q5']
  const repeats = isQuick ? 1 : args.number('repeats', 3)
  const idleSec = isQuick ? QUICK_IDLE_SEC : args.number('idle-sec', 60)
  const cooldownSec = isQuick ? QUICK_COOLDOWN_SEC : args.number('cooldown-sec', 20)
  const defaultBackend = isNoGpu ? 'cpu' : process.platform === 'darwin' ? 'metal' : 'cuda'
  const expectBackend = args.text('expect-backend') ?? defaultBackend
  const vadModelPath = path.resolve(args.text('vad-model') ?? VAD_MODEL)

  const manifestPath = path.join(audioDir, 'manifest.json')
  if (!existsSync(manifestPath))
    fail(`${manifestPath} 이(가) 없습니다. prepare로 만든 폴더를 --audio로 주세요`)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as BenchManifest
  const probeInput: BenchInput = { id: 'probe', source: 'probe', ...manifest.probe }
  const selected = args.list('inputs')
  const inputs = isQuick
    ? [probeInput]
    : manifest.inputs.filter((input) => selected.length === 0 || selected.includes(input.id))
  if (inputs.length === 0) fail('측정할 입력이 없습니다')

  const modelPaths = modelIds.map((id) => path.join(modelsDir, modelFileOf(id)))
  for (const target of [binPath, vadModelPath, ...modelPaths]) {
    if (!existsSync(target)) fail(`${target} 이(가) 없습니다`)
  }
  await verifyInputs({
    audioDir,
    inputs: [probeInput, ...inputs.filter((input) => input.id !== 'probe')]
  })

  const tag = `${machine}-stt${isNoGpu ? '-cpu' : ''}${isQuick ? '-quick' : ''}-${stampOf()}`
  const outDir = path.resolve(args.text('out') ?? path.join(BENCH_RESULTS_DIR, tag))
  const workDir = path.join(outDir, 'work')
  await mkdir(workDir, { recursive: true })

  const { stt: threads } = await threadPlan()
  const whisperArgsOf = ({
    modelPath,
    input,
    outputPath
  }: {
    modelPath: string
    input: BenchInput
    outputPath: string
  }) => [
    ...buildWhisperArgs({
      modelPath,
      audioPath: path.join(audioDir, input.file),
      outputPath,
      threads,
      vadModelPath
    }),
    ...(isNoGpu ? ['-ng'] : [])
  ]

  // 1. 백엔드 확인. --no-prints를 빼야 초기화 로그가 나온다
  info(`백엔드 확인 (기대: ${expectBackend})`)
  const probe = await measureCommand({
    command: binPath,
    args: whisperArgsOf({
      modelPath: modelPaths[0],
      input: probeInput,
      outputPath: path.join(workDir, 'probe')
    }).filter((arg) => arg !== '--no-prints')
  })
  const backend = detectWhisperBackend(probe.stderr)
  await writeFile(path.join(outDir, 'probe-stderr.log'), probe.stderr)
  if (probe.code !== 0)
    fail(`whisper-cli 확인 실행 실패 (${probe.code}). ${outDir}/probe-stderr.log 확인`)
  if (backend !== expectBackend) {
    fail(
      `백엔드가 ${backend}입니다 (기대 ${expectBackend}). 바이너리 빌드를 확인하세요. 로그: ${outDir}/probe-stderr.log`
    )
  }
  info(`· ${backend} 사용 확인`)

  // 2. 환경 기록
  const env = await collectEnv({ machine, binPath, modelPaths: [...modelPaths, vadModelPath] })
  const engine = 'whisper.cpp'

  // 3. 전력 수집 시작 → 유휴 기준선
  const sampler = await startPowerSampler({
    samplesCsvPath: path.join(outDir, 'samples.csv'),
    lhmUrl: args.text('lhm-url')
  })
  info(`유휴 전력 ${idleSec}초 측정 (이 동안 장비를 건드리지 마세요)`)
  const idleFrom = Date.now()
  await sleep(idleSec * MS_PER_SEC)
  const idle = idleBaseline({ samples: sampler.samples, from: idleFrom, to: Date.now() })
  const primary = primaryPowerSources(sampler.sources)
  info(`· 전력 출처 ${[...sampler.sources].join(', ') || '없음'} → 대표 범위 ${primary.scope}`)
  if (primary.scope === 'none') warn('전력을 읽지 못했습니다. 시간·메모리만 기록합니다')

  const runsPath = path.join(outDir, 'runs.csv')
  await writeFile(runsPath, csvLine([...RUN_COLUMNS]))
  const totalRuns = modelIds.length * inputs.length * repeats
  const totalAudioMin =
    (inputs.reduce((sum, input) => sum + input.durationSec, 0) / 60) * modelIds.length * repeats
  info(`측정 ${totalRuns}회 · 음성 합계 ${totalAudioMin.toFixed(0)}분 · 결과 ${outDir}`)

  // 4. 측정. 모델 → 입력 → 반복 순서. 매 실행은 새 프로세스라 앱처럼 모델 로딩을 포함한다
  let seq = 0
  let failures = 0
  for (const [modelIndex, modelId] of modelIds.entries()) {
    const modelPath = modelPaths[modelIndex]
    const transcriptDir = path.join(outDir, 'transcripts', modelId)
    await mkdir(transcriptDir, { recursive: true })

    for (const input of inputs) {
      for (let run = 1; run <= repeats; run += 1) {
        seq += 1
        await sleep(cooldownSec * MS_PER_SEC)
        info(
          `[${seq}/${totalRuns}] ${modelId} · ${input.id} (${(input.durationSec / 60).toFixed(1)}분) · ${run}회차`
        )

        const outputPath = path.join(workDir, `${modelId}.${input.id}.run${run}`)
        let lastReported = -PROGRESS_STEP_PERCENT
        const measured = await measureCommand({
          command: binPath,
          args: whisperArgsOf({ modelPath, input, outputPath }),
          onStderrLine: (line) => {
            const percent = parseWhisperProgress(line)
            if (percent === null || percent < lastReported + PROGRESS_STEP_PERCENT) return
            lastReported = percent
            info(`  ${percent}%`)
          }
        })
        // 마지막 샘플이 도착할 시간을 준다
        await sleep(MS_PER_SEC * 1.5)

        const wallSec = (measured.endedAt - measured.startedAt) / MS_PER_SEC
        const power = powerOf({ sampler, idle, from: measured.startedAt, to: measured.endedAt })
        const vram = statOf({
          samples: sampler.samples,
          source: 'nvidia-gpu',
          metric: 'vram_mb',
          from: measured.startedAt,
          to: measured.endedAt
        })
        const idleVram = idle.get('nvidia-gpu:vram_mb')
        const windowStat = (source: string, metric: string) =>
          statOf({
            samples: sampler.samples,
            source,
            metric,
            from: measured.startedAt,
            to: measured.endedAt
          })
        const sysRam = windowStat('mac-mem', 'ram_used_mb')
        const swap = windowStat('mac-mem', 'swap_used_mb')
        const idleSwap = idle.get('mac-mem:swap_used_mb')
        const soc = windowStat('mac-soc', 'power_w')

        if (measured.code === 0 && existsSync(`${outputPath}.json`)) {
          const segments = parseWhisperOutput(await readFile(`${outputPath}.json`))
          await writeFile(
            path.join(transcriptDir, `${input.id}.run${run}.txt`),
            `${segments.map((segment) => segment.text).join('\n')}\n`
          )
          await rm(`${outputPath}.json`, { force: true })
        } else {
          failures += 1
          await appendFile(
            path.join(outDir, 'errors.log'),
            `[${new Date().toISOString()}] ${modelId} ${input.id} run${run} code=${measured.code}\n${measured.stderr.slice(-2000)}\n\n`
          )
          warn(`실패 (code ${measured.code}). errors.log에 기록했습니다`)
        }

        const row: RunRow = {
          date: new Date().toISOString(),
          experiment: isNoGpu ? 'E1-cpu' : 'E3',
          machine,
          engine,
          backend,
          model: modelId,
          input_id: input.id,
          input_min: fixed(input.durationSec / 60, 2),
          seq,
          run,
          wall_sec: fixed(wallSec, 2),
          rtf: fixed(wallSec / input.durationSec, 4),
          max_rss_mb: fixed(measured.maxRssMb, 0),
          peak_footprint_mb: fixed(measured.peakFootprintMb, 0),
          vram_peak_mb: vram && idleVram !== undefined ? fixed(vram.max - idleVram, 0) : null,
          sys_ram_peak_mb: fixed(sysRam?.max, 0),
          // 측정 중 스왑이 늘었다면 메모리가 모자랐다는 신호다 (E5)
          swap_growth_mb: swap && idleSwap !== undefined ? fixed(swap.max - idleSwap, 0) : null,
          power_scope: power.scope,
          idle_w: fixed(power.idleW, 2),
          avg_w: fixed(power.avgW, 2),
          max_w: fixed(power.maxW, 2),
          soc_avg_w: fixed(soc?.avg, 2),
          extra_wh: fixed(power.extraWh, 3),
          extra_wh_per_audio_h:
            power.extraWh === null
              ? null
              : fixed(power.extraWh / (input.durationSec / SEC_PER_HOUR), 2),
          exit_code: measured.code,
          started_at: measured.startedAt,
          ended_at: measured.endedAt
        }
        await appendFile(runsPath, csvLine(RUN_COLUMNS.map((column) => row[column])))
        info(
          `  ${wallSec.toFixed(1)}초 · RTF ${(wallSec / input.durationSec).toFixed(3)}` +
            (power.avgW === null
              ? ''
              : ` · 평균 ${power.avgW.toFixed(1)}W (유휴 ${power.idleW?.toFixed(1)}W)`)
        )
      }
    }
  }

  // 5. 끝난 뒤 유휴를 다시 재서 측정 중 기준선이 흔들렸는지 남긴다 (발열·백그라운드 작업)
  info(`마무리 유휴 ${Math.round(idleSec / 2)}초 측정`)
  const endIdleFrom = Date.now()
  await sleep((idleSec / 2) * MS_PER_SEC)
  const endIdle = idleBaseline({ samples: sampler.samples, from: endIdleFrom, to: Date.now() })
  await sampler.stop()
  await rm(workDir, { recursive: true, force: true })

  await writeFile(
    path.join(outDir, 'session.json'),
    `${JSON.stringify(
      {
        options: {
          machine,
          modelIds,
          inputs: inputs.map((i) => i.id),
          repeats,
          idleSec,
          cooldownSec,
          isNoGpu,
          threads
        },
        backend,
        powerScope: primary.scope,
        powerSources: [...sampler.sources],
        idleStart: Object.fromEntries(idle),
        idleEnd: Object.fromEntries(endIdle),
        failures,
        env
      },
      null,
      2
    )}\n`
  )
  info(`\n완료: ${totalRuns}회 중 실패 ${failures}회 → ${outDir}`)
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error))
})
