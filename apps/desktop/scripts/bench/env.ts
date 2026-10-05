import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { sha256Of } from '../download'

const execFileAsync = promisify(execFile)
const BYTES_PER_GB = 1024 ** 3

/** 실패해도 측정을 막지 않는다. 기록만 비워 둔다 */
const tryRun = async (command: string, args: string[]) => {
  try {
    const { stdout } = await execFileAsync(command, args, { windowsHide: true })
    return stdout.trim()
  } catch {
    return null
  }
}

const macHardware = async () => {
  const raw = await tryRun('system_profiler', ['SPHardwareDataType', '-json'])
  if (!raw) return null
  const item = JSON.parse(raw).SPHardwareDataType?.[0] ?? {}

  return {
    model: item.machine_model ?? null,
    chip: item.chip_type ?? null,
    memory: item.physical_memory ?? null,
    performanceCores: await tryRun('sysctl', ['-n', 'hw.perflevel0.logicalcpu']),
    lowPowerMode: await tryRun('pmset', ['-g'])
  }
}

const nvidiaGpu = () =>
  tryRun('nvidia-smi', ['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader'])

interface CollectEnvParams {
  machine: string
  binPath: string
  modelPaths: string[]
}

/** 결과를 다시 만들 수 있도록 장비·OS·바이너리·모델 지문을 남긴다 (plan.md E0) */
export const collectEnv = async ({ machine, binPath, modelPaths }: CollectEnvParams) => ({
  machine,
  collectedAt: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  osRelease: os.release(),
  osVersion: os.version(),
  cpuModel: os.cpus()[0]?.model ?? null,
  logicalCores: os.cpus().length,
  totalMemoryGb: Number((os.totalmem() / BYTES_PER_GB).toFixed(1)),
  node: process.version,
  mac: process.platform === 'darwin' ? await macHardware() : null,
  nvidia: process.platform === 'win32' ? await nvidiaGpu() : null,
  gitCommit: await tryRun('git', ['rev-parse', 'HEAD']),
  gitDirty: Boolean(await tryRun('git', ['status', '--porcelain'])),
  binary: { path: binPath, sha256: await sha256Of(binPath) },
  models: await Promise.all(
    modelPaths.map(async (modelPath) => ({
      file: path.basename(modelPath),
      sha256: await sha256Of(modelPath)
    }))
  )
})
