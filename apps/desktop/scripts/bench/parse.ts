/**
 * 측정 도구 출력 파서와 구간 통계. 외부 프로세스 없이 테스트할 수 있게 순수 함수만 둔다.
 * 전력 샘플은 모두 같은 모양(PowerSample)으로 바꿔 장비가 달라도 같은 계산을 쓴다.
 */

export interface PowerSample {
  /** epoch ms */
  t: number
  /** 측정 출처. mac-system·mac-soc·mac-mem(macmon), nvidia-gpu(nvidia-smi), lhm-cpu(LibreHardwareMonitor) */
  source: string
  /** power_w, vram_mb 등 */
  metric: string
  value: number
}

const BYTES_PER_MB = 1024 * 1024
const MS_PER_HOUR = 3_600_000

/** macOS `/usr/bin/time -l`이 stderr 끝에 붙이는 메모리 값. 단위는 바이트다 */
export const parseMacTime = (stderr: string) => {
  const mbOf = (label: string) => {
    const match = stderr.match(new RegExp(`(\\d+)\\s+${label}`))
    return match ? Number(match[1]) / BYTES_PER_MB : null
  }

  return {
    maxRssMb: mbOf('maximum resident set size'),
    peakFootprintMb: mbOf('peak memory footprint')
  }
}

/**
 * whisper-cli가 실제로 GPU를 썼는지. `-ng`로 GPU를 꺼도 Metal 초기화 로그는 찍히므로
 * `use gpu = 0` 줄을 먼저 본다 (2026-10-05 M1 Pro, whisper.cpp v1.8.4에서 확인).
 */
export const detectWhisperBackend = (stderr: string) => {
  const useGpu = stderr.match(/use gpu\s*=\s*(\d)/)
  if (useGpu && useGpu[1] === '0') return 'cpu'
  if (/ggml_cuda_init: found [1-9]/.test(stderr)) return 'cuda'
  if (/ggml_metal_device_init/.test(stderr)) return 'metal'
  if (/vulkan/i.test(stderr)) return 'vulkan'
  return 'cpu'
}

interface MacmonLine {
  timestamp?: string
  sys_power?: number
  all_power?: number
  cpu_power?: number
  gpu_power?: number
  ane_power?: number
  ram_power?: number
  memory?: { ram_usage?: number; swap_usage?: number }
  temp?: { cpu_temp_avg?: number; gpu_temp_avg?: number }
}

/**
 * `macmon pipe` 한 줄(JSON)을 샘플로 바꾼다. sudo 없이 1초 단위로 읽힌다.
 * - mac-system: sys_power = SMC가 보고하는 시스템 전체 전력. 0이면 이 장비에서 지원하지 않는 것으로 본다
 * - mac-soc: all_power = CPU+GPU+ANE
 * - mac-mem: 시스템 전체 메모리·스왑 사용량 (E5 스왑 확인용)
 * ioreg SystemLoad는 약 50초마다만 갱신돼 쓰지 않는다 (2026-10-05 M1 Pro에서 확인).
 */
export const parseMacmonLine = (line: string): PowerSample[] => {
  let parsed: MacmonLine
  try {
    parsed = JSON.parse(line) as MacmonLine
  } catch {
    return []
  }
  const t = Date.parse(parsed.timestamp ?? '')
  if (!Number.isFinite(t)) return []

  const metrics: [string, string, number | undefined][] = [
    ['mac-system', 'power_w', parsed.sys_power ? parsed.sys_power : undefined],
    ['mac-soc', 'power_w', parsed.all_power],
    ['mac-soc', 'cpu_w', parsed.cpu_power],
    ['mac-soc', 'gpu_w', parsed.gpu_power],
    ['mac-soc', 'ane_w', parsed.ane_power],
    ['mac-soc', 'ram_w', parsed.ram_power],
    ['mac-soc', 'cpu_temp_c', parsed.temp?.cpu_temp_avg],
    ['mac-soc', 'gpu_temp_c', parsed.temp?.gpu_temp_avg],
    [
      'mac-mem',
      'ram_used_mb',
      parsed.memory?.ram_usage === undefined ? undefined : parsed.memory.ram_usage / BYTES_PER_MB
    ],
    [
      'mac-mem',
      'swap_used_mb',
      parsed.memory?.swap_usage === undefined ? undefined : parsed.memory.swap_usage / BYTES_PER_MB
    ]
  ]

  return metrics
    .filter(([, , value]) => typeof value === 'number' && Number.isFinite(value))
    .map(([source, metric, value]) => ({ t, source, metric, value: value as number }))
}

export const NVIDIA_SMI_QUERY = 'timestamp,power.draw,memory.used,utilization.gpu,temperature.gpu'

/** `2026/10/05 14:03:21.123, 45.67, 1234, 87, 61` (nounits). 시각은 장비의 현지 시각이다 */
export const parseNvidiaSmiLine = (line: string): PowerSample[] => {
  const [timestamp, power, memory, utilization, temperature] = line.split(',').map((v) => v.trim())
  const time = timestamp?.match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/)
  if (!time) return []

  const [, year, month, day, hour, minute, second, fraction = '0'] = time
  const t = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(fraction.padEnd(3, '0').slice(0, 3))
  ).getTime()

  const metrics: [string, string | undefined][] = [
    ['power_w', power],
    ['vram_mb', memory],
    ['gpu_util', utilization],
    ['temp_c', temperature]
  ]
  return metrics
    .map(([metric, raw]) => ({ metric, value: Number(raw) }))
    .filter(({ value }) => Number.isFinite(value))
    .map(({ metric, value }) => ({ t, source: 'nvidia-gpu', metric, value }))
}

interface LhmNode {
  Text?: string
  Value?: string
  ImageURL?: string
  Children?: LhmNode[]
}

/**
 * LibreHardwareMonitor 웹 서버(data.json)에서 CPU 패키지 전력(W)을 찾는다.
 * CPU 하드웨어 노드 아래 "Powers" 묶음의 "Package" 센서를 쓴다. 형식이 다르면 null.
 */
export const findLhmCpuPackageW = (root: LhmNode): number | null => {
  const findPackage = (node: LhmNode, isUnderCpu: boolean): number | null => {
    const isCpu = isUnderCpu || (node.ImageURL ?? '').toLowerCase().includes('cpu')
    if (isCpu && /package/i.test(node.Text ?? '') && /W\s*$/.test(node.Value ?? '')) {
      const value = Number((node.Value ?? '').replace(',', '.').replace(/[^\d.]/g, ''))
      if (Number.isFinite(value)) return value
    }
    for (const child of node.Children ?? []) {
      const found = findPackage(child, isCpu)
      if (found !== null) return found
    }
    return null
  }

  return findPackage(root, false)
}

export interface WindowStat {
  samples: number
  avg: number
  max: number
}

/** [from, to] 구간에 든 한 출처·지표의 평균과 최댓값 */
export const statOf = ({
  samples,
  source,
  metric,
  from,
  to
}: {
  samples: PowerSample[]
  source: string
  metric: string
  from: number
  to: number
}): WindowStat | null => {
  const values = samples
    .filter((s) => s.source === source && s.metric === metric && s.t >= from && s.t <= to)
    .map((s) => s.value)
  if (values.length === 0) return null

  return {
    samples: values.length,
    avg: values.reduce((sum, v) => sum + v, 0) / values.length,
    max: Math.max(...values)
  }
}

/** 처리 때문에 더 쓴 전력량(Wh) = (구간 평균 − 유휴 평균) × 구간 길이 */
export const extraWhOf = ({
  avgW,
  idleW,
  durationMs
}: {
  avgW: number
  idleW: number
  durationMs: number
}) => ((avgW - idleW) * durationMs) / MS_PER_HOUR

export const median = (values: number[]) => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}
