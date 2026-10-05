import { type ChildProcess, spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'

import { warn } from '../log'
import {
  findLhmCpuPackageW,
  NVIDIA_SMI_QUERY,
  parseMacmonLine,
  parseNvidiaSmiLine,
  type PowerSample
} from './parse'

const SAMPLE_INTERVAL_MS = 1000

interface StartPowerSamplerParams {
  /** 모든 샘플을 그대로 남길 CSV. 계산을 다시 하거나 검산할 때 쓴다 */
  samplesCsvPath: string
  /** LibreHardwareMonitor 웹 서버 주소 (예: http://localhost:8085/data.json). Windows CPU 전력용 */
  lhmUrl?: string
}

/** 줄 단위로 끊어 읽는다. 마지막 미완성 줄은 다음 조각과 합친다 */
const onLines = (child: ChildProcess, handle: (line: string) => void) => {
  let tail = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    const lines = (tail + chunk.toString()).split(/\r?\n/)
    tail = lines.pop() ?? ''
    lines.forEach(handle)
  })
}

/**
 * 장비에서 소프트웨어로 읽을 수 있는 전력을 1초마다 모은다.
 * - Mac: macmon = 시스템 전체(SMC)·칩(CPU+GPU+ANE) 전력, 메모리·스왑. sudo가 필요 없다
 * - Windows: nvidia-smi = GPU 보드 전력·VRAM, LibreHardwareMonitor = CPU 패키지 전력(선택)
 */
export const startPowerSampler = async ({ samplesCsvPath, lhmUrl }: StartPowerSamplerParams) => {
  const samples: PowerSample[] = []
  const sources = new Set<string>()
  const children: ChildProcess[] = []
  const timers: NodeJS.Timeout[] = []
  const csv = createWriteStream(samplesCsvPath, { flags: 'a' })
  csv.write('t,source,metric,value\n')

  const record = (sample: PowerSample) => {
    samples.push(sample)
    sources.add(sample.source)
    csv.write(`${sample.t},${sample.source},${sample.metric},${sample.value}\n`)
  }

  /** 이전 조회가 끝나기 전에는 다음 조회를 시작하지 않는다 */
  const poll = (read: () => Promise<PowerSample[]>) => {
    let isBusy = false
    timers.push(
      setInterval(() => {
        if (isBusy) return
        isBusy = true
        read()
          .then((items) => items.forEach(record))
          .catch(() => undefined)
          .finally(() => {
            isBusy = false
          })
      }, SAMPLE_INTERVAL_MS)
    )
  }

  /** 측정 도구를 자식 프로세스로 띄워 한 줄씩 읽는다. 없으면 경고만 남긴다 */
  const follow = (command: string, args: string[], parse: (line: string) => PowerSample[]) => {
    const child = spawn(command, args, { windowsHide: true })
    child.on('error', () =>
      warn(`${command}를 실행할 수 없어 해당 전력을 건너뜁니다 (README 준비 단계 확인)`)
    )
    onLines(child, (line) => parse(line).forEach(record))
    children.push(child)
  }

  if (process.platform === 'darwin') {
    follow('macmon', ['pipe', '-i', String(SAMPLE_INTERVAL_MS)], parseMacmonLine)
  }

  if (process.platform === 'win32') {
    follow(
      'nvidia-smi',
      [
        `--query-gpu=${NVIDIA_SMI_QUERY}`,
        '--format=csv,noheader,nounits',
        '-lms',
        String(SAMPLE_INTERVAL_MS)
      ],
      parseNvidiaSmiLine
    )
  }

  if (lhmUrl) {
    poll(async () => {
      const response = await fetch(lhmUrl)
      const watts = findLhmCpuPackageW(await response.json())
      return watts === null
        ? []
        : [{ t: Date.now(), source: 'lhm-cpu', metric: 'power_w', value: watts }]
    })
  }

  const stop = async () => {
    timers.forEach(clearInterval)
    children.forEach((child) => child.kill())
    await new Promise<void>((resolve) => csv.end(resolve))
  }

  return { samples, sources, stop }
}

export type PowerSampler = Awaited<ReturnType<typeof startPowerSampler>>

/**
 * 결과 표의 대표 전력. 측정 범위가 넓은 출처를 고르고, Windows는 GPU와 CPU를 더한다.
 * scope는 결과를 읽을 때 "무엇을 잰 값인지"를 밝히는 이름이다 (plan.md 4절).
 */
export const primaryPowerSources = (sources: Set<string>) => {
  if (sources.has('mac-system')) return { scope: 'system', sources: ['mac-system'] }
  if (sources.has('mac-soc')) return { scope: 'soc', sources: ['mac-soc'] }

  const windows = ['nvidia-gpu', 'lhm-cpu'].filter((source) => sources.has(source))
  if (windows.length === 2) return { scope: 'gpu+cpu', sources: windows }
  if (windows.length === 1)
    return { scope: windows[0] === 'nvidia-gpu' ? 'gpu' : 'cpu', sources: windows }

  return { scope: 'none', sources: [] }
}
