import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const extractArchive = async ({
  archivePath,
  destDir
}: {
  archivePath: string
  destDir: string
}) => {
  // bzip2·zip 디코더를 의존성으로 들이지 않는다. bsdtar가 확장자로 압축 방식을 판별한다
  // (macOS와 Windows 10 1803+ 기본 포함, references/distribution.md).
  await execFileAsync('tar', ['-xf', archivePath, '-C', destDir])
}

export const which = async (command: string) => {
  try {
    const { stdout } = await execFileAsync('which', [command])
    return stdout.trim() || null
  } catch {
    return null
  }
}

/** macOS 격리 속성(com.apple.quarantine)이 남아 있으면 실행이 차단된다. */
export const clearQuarantine = async (targetPath: string) => {
  if (process.platform !== 'darwin') return
  try {
    await execFileAsync('xattr', ['-d', 'com.apple.quarantine', targetPath])
  } catch {
    // 속성이 없으면 실패하는 게 정상이므로 무시한다.
  }
}

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

interface RunParams {
  command: string
  args: string[]
  onStderrLine?: (line: string) => void
}

/** 외부 바이너리 실행. 동기 spawn은 쓰지 않는다 (references/pitfalls.md). */
export const run = ({ command, args, onStderrLine }: RunParams) =>
  new Promise<RunResult>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
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
      const lines = stderrTail.split('\n')
      stderrTail = lines.pop() ?? ''
      lines.forEach(onStderrLine)
    })

    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
