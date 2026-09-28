/**
 * 실행 내내 메모리를 재서 단계별 최고값을 남긴다.
 *
 * 71분의 관문은 속도가 아니라 메모리인데 소요 시간과 달리 메모리는 저절로 남지 않는다 (계획 §6).
 * `measureUserAgentSpecificMemory`는 **dedicated worker까지 같은 agent cluster로 묶어** 한 번에 세고
 * 워커가 `terminate`되면 그만큼 즉시 빠지므로, "워커를 순차로 띄워 피크를 낮춘다"는 전제를 그대로 검증한다.
 *
 * 다만 이 API는 GC 시점에 맞춰 값을 돌려주므로 **호출 하나가 수 초 걸리고** 짧은 치솟음은 놓친다.
 * 세는 대상도 JS 쪽이라 WASM 힙·WebGPU 버퍼·`AudioBuffer` 같은 외부 할당은 빠질 수 있다.
 * 그래서 여기서 나오는 값은 **하한선**이고, Chrome 작업 관리자 숫자와 같이 봐야 한다.
 */

import type { PipelineStage } from '../pipeline/messages'

/** 샘플 사이에 쉬는 시간. 호출 자체가 GC를 기다리느라 이보다 훨씬 오래 걸린다 */
const SAMPLE_GAP_MS = 200

/**
 * 워커 몫을 가려내는 scope 이름 조각. 명세는 `DedicatedWorkerGlobalScope`를 쓰지만
 * 이름이 바뀌어도 합계 피크는 멀쩡하도록 정확히 맞추지 않고 포함 여부만 본다.
 */
const WORKER_SCOPE_HINT = 'Worker'

const PIPELINE_STAGES: PipelineStage[] = ['decode', 'diarize', 'stt', 'merge']

interface MemoryAttribution {
  scope?: string
}

interface MemoryBreakdownEntry {
  bytes: number
  attribution: MemoryAttribution[]
}

interface MemoryMeasurement {
  bytes: number
  breakdown: MemoryBreakdownEntry[]
}

/** 아직 표준 lib에 없는 API라 여기서만 좁혀 쓴다 */
type MeasurablePerformance = Performance & {
  measureUserAgentSpecificMemory?: () => Promise<MemoryMeasurement>
}

type StagePeaks = Partial<Record<PipelineStage, number>>

export interface MemoryReport {
  /** 실행 전체의 최고값 */
  peakBytes: number
  /** 최고값을 찍은 순간 워커들이 쥐고 있던 몫 */
  peakWorkerBytes: number
  stagePeaks: StagePeaks
  /** 0이면 한 번도 재지 못한 것이다 */
  sampleCount: number
}

const EMPTY_REPORT: MemoryReport = {
  peakBytes: 0,
  peakWorkerBytes: 0,
  stagePeaks: {},
  sampleCount: 0
}

/** false면 `crossOriginIsolated`가 아니거나 브라우저가 이 API를 모른다 */
export const isMemoryMeasurable = () =>
  typeof (performance as MeasurablePerformance).measureUserAgentSpecificMemory === 'function'

const measure = () => (performance as MeasurablePerformance).measureUserAgentSpecificMemory?.()

const sumWorkerBytes = (measurement: MemoryMeasurement) =>
  measurement.breakdown
    .filter((entry) => entry.attribution.some((item) => item.scope?.includes(WORKER_SCOPE_HINT)))
    .reduce((total, entry) => total + entry.bytes, 0)

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const mergeStagePeaks = ({ previous, next }: { previous: StagePeaks; next: StagePeaks }) =>
  PIPELINE_STAGES.reduce<StagePeaks>((merged, stage) => {
    const peak = Math.max(previous[stage] ?? 0, next[stage] ?? 0)

    return peak > 0 ? { ...merged, [stage]: peak } : merged
  }, {})

/** 디코딩과 파이프라인은 따로 재므로 한 실행의 값으로 합친다 */
export const mergeMemoryReports = ({
  previous,
  next
}: {
  previous: MemoryReport | null
  next: MemoryReport
}): MemoryReport => {
  if (!previous) return next

  return {
    peakBytes: Math.max(previous.peakBytes, next.peakBytes),
    // 워커 몫은 더 높은 피크를 찍은 쪽의 값이라야 같은 순간의 내역이 된다
    peakWorkerBytes:
      next.peakBytes > previous.peakBytes ? next.peakWorkerBytes : previous.peakWorkerBytes,
    stagePeaks: mergeStagePeaks({ previous: previous.stagePeaks, next: next.stagePeaks }),
    sampleCount: previous.sampleCount + next.sampleCount
  }
}

/** 표에 찍을 순서대로. 한 번도 재지 못한 단계는 빠진다 */
export const stagePeakEntries = (memory: MemoryReport) =>
  PIPELINE_STAGES.filter((stage) => (memory.stagePeaks[stage] ?? 0) > 0).map((stage) => ({
    stage,
    bytes: memory.stagePeaks[stage] ?? 0
  }))

/**
 * 샘플링을 시작한다. `mark`로 단계를 바꾸면 이후 샘플이 그 단계로 쌓이고,
 * `stop`은 기다리지 않고 지금까지의 값을 돌려준다 — 측정 한 번이 수 초라 끝을 붙잡으면 안 된다.
 */
export const startMemorySampler = (initialStage: PipelineStage) => {
  let stage = initialStage
  let isStopped = false
  let report = EMPTY_REPORT

  const record = (measurement: MemoryMeasurement) => {
    report = {
      peakBytes: Math.max(report.peakBytes, measurement.bytes),
      peakWorkerBytes:
        measurement.bytes > report.peakBytes ? sumWorkerBytes(measurement) : report.peakWorkerBytes,
      stagePeaks: {
        ...report.stagePeaks,
        [stage]: Math.max(report.stagePeaks[stage] ?? 0, measurement.bytes)
      },
      sampleCount: report.sampleCount + 1
    }
  }

  const loop = async () => {
    while (!isStopped) {
      try {
        const measurement = await measure()
        if (!measurement) return
        // 측정을 기다리는 사이에 멈췄으면 이 샘플은 이미 끝난 실행의 것이다
        if (isStopped) return

        record(measurement)
      } catch (error) {
        // crossOriginIsolated가 아니거나 브라우저가 거부한 경우. 실행 자체에는 지장이 없다
        console.warn('메모리를 재지 못했습니다:', error)
        return
      }

      await delay(SAMPLE_GAP_MS)
    }
  }

  void loop()

  return {
    mark: (next: PipelineStage) => {
      stage = next
    },
    stop: () => {
      isStopped = true

      return report
    }
  }
}
