import { spawn } from 'node:child_process'

import { parseMacTime } from './parse'

const BYTES_PER_MB = 1024 * 1024
const WINDOWS_MEMORY_POLL_MS = 500

export interface MeasuredRun {
  code: number | null
  stdout: string
  stderr: string
  startedAt: number
  endedAt: number
  /** 최대 상주 메모리. Windows는 PeakWorkingSet */
  maxRssMb: number | null
  /** macOS만: GPU 버퍼까지 포함한 최대 메모리 사용량 */
  peakFootprintMb: number | null
}

interface MeasureCommandParams {
  command: string
  args: string[]
  onStderrLine?: (line: string) => void
}

/**
 * Windows에는 `/usr/bin/time`이 없어 PowerShell 하나를 띄워 자식 프로세스의 PeakWorkingSet64를 지켜본다.
 * 0.5초마다 새 프로세스를 띄우면 그 자체가 전력 측정을 흔들므로 루프는 PowerShell 안에서 돈다.
 */
const watchWindowsPeakMemory = (pid: number) => {
  const script = [
    `$peak = 0`,
    `while ($true) {`,
    `  $p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
    `  if (-not $p) { break }`,
    `  if ($p.PeakWorkingSet64 -gt $peak) { $peak = $p.PeakWorkingSet64 }`,
    `  Start-Sleep -Milliseconds ${WINDOWS_MEMORY_POLL_MS}`,
    `}`,
    `Write-Output $peak`
  ].join('\n')
  const watcher = spawn('powershell', ['-NoProfile', '-Command', script], { windowsHide: true })
  let output = ''
  watcher.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString()
  })

  return new Promise<number | null>((resolve) => {
    watcher.on('error', () => resolve(null))
    watcher.on('close', () => {
      const bytes = Number(output.trim())
      resolve(Number.isFinite(bytes) && bytes > 0 ? bytes / BYTES_PER_MB : null)
    })
  })
}

/**
 * 외부 바이너리를 실행하며 시작·종료 시각과 최대 메모리를 잰다.
 * macOS는 `/usr/bin/time -l`로 감싸 커널이 집계한 값을 받는다.
 */
export const measureCommand = ({ command, args, onStderrLine }: MeasureCommandParams) =>
  new Promise<MeasuredRun>((resolve, reject) => {
    const isMac = process.platform === 'darwin'
    const startedAt = Date.now()
    const child = isMac
      ? spawn('/usr/bin/time', ['-l', command, ...args])
      : spawn(command, args, { windowsHide: true })
    const peakMemory =
      process.platform === 'win32' && child.pid
        ? watchWindowsPeakMemory(child.pid)
        : Promise.resolve(null)

    let stdout = ''
    let stderr = ''
    let stderrTail = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderr += text
      if (!onStderrLine) return
      stderrTail += text
      const lines = stderrTail.split(/\r?\n/)
      stderrTail = lines.pop() ?? ''
      lines.forEach(onStderrLine)
    })

    child.on('error', reject)
    child.on('close', (code) => {
      const endedAt = Date.now()
      peakMemory.then((windowsPeakMb) => {
        const mac = isMac ? parseMacTime(stderr) : { maxRssMb: null, peakFootprintMb: null }
        resolve({
          code,
          stdout,
          stderr,
          startedAt,
          endedAt,
          maxRssMb: mac.maxRssMb ?? windowsPeakMb,
          peakFootprintMb: mac.peakFootprintMb
        })
      })
    })
  })
