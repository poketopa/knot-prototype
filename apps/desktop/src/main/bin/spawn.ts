import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'

const KILL_GRACE_MS = 2_000

export class BinaryExecutionError extends Error {
  code: number | null
  stdout: string
  stderr: string
  stdoutPath?: string
  stderrPath?: string

  constructor({
    command,
    code,
    stdout,
    stderr,
    stdoutPath,
    stderrPath,
    reason
  }: {
    command: string
    code: number | null
    stdout: string
    stderr: string
    stdoutPath?: string
    stderrPath?: string
    reason: string
  }) {
    super(`${command} 실행에 실패했습니다 (${reason})`)
    this.name = 'BinaryExecutionError'
    this.code = code
    this.stdout = stdout
    this.stderr = stderr
    this.stdoutPath = stdoutPath
    this.stderrPath = stderrPath
  }
}

interface RunBinaryParams {
  command: string
  args: string[]
  /** stdin으로 넘길 본문. 넘기면 쓰고 바로 닫는다 (claude -p처럼 argv에 못 넣는 긴 프롬프트용) */
  input?: string
  /** 작업 폴더. 프로젝트 폴더의 설정 파일을 읽어 가는 CLI는 빈 폴더에서 돌린다 */
  cwd?: string
  /** GUI 앱의 PATH는 로그인 셸과 다르다. 필요하면 바꿔 넘긴다 (references/pitfalls.md) */
  env?: NodeJS.ProcessEnv
  /** 진행률 파싱용. 라인 단위로 잘라 넘긴다 */
  onStdoutLine?: (line: string) => void
  onStderrLine?: (line: string) => void
  /** 오래 걸리는 외부 LLM/바이너리가 멈췄을 때 자식 프로세스를 종료한다 */
  timeoutMs?: number
  /** 자식 stdout/stderr를 도착하는 즉시 파일에도 남긴다. 실패해도 partial bytes가 보존된다 */
  stdoutPath?: string
  stderrPath?: string
}

interface LineSplitter {
  push: (text: string) => void
}

const createLineSplitter = (onLine?: (line: string) => void): LineSplitter => {
  let tail = ''

  return {
    push: (text: string) => {
      if (!onLine) return
      tail += text
      const lines = tail.split('\n')
      tail = lines.pop() ?? ''
      lines.forEach(onLine)
    }
  }
}

/**
 * 외부 바이너리 실행. 동기 spawn은 UI를 멈추므로 쓰지 않는다 (references/pitfalls.md).
 * 종료 코드가 0이 아니면 stderr 꼬리를 담은 한국어 에러를 던진다.
 */
export const runBinary = ({
  command,
  args,
  input,
  cwd,
  env,
  onStdoutLine,
  onStderrLine,
  timeoutMs,
  stdoutPath,
  stderrPath
}: RunBinaryParams) =>
  new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, cwd, env })
    const stdoutSplitter = createLineSplitter(onStdoutLine)
    const stderrSplitter = createLineSplitter(onStderrLine)
    const stdoutFile = stdoutPath ? createWriteStream(stdoutPath, { flags: 'wx' }) : undefined
    const stderrFile = stderrPath ? createWriteStream(stderrPath, { flags: 'wx' }) : undefined
    let stdout = ''
    let stderr = ''
    let didTimeout = false
    let didKill = false
    let didReject = false
    let killTimer: NodeJS.Timeout | undefined
    const timeout =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            didTimeout = true
            child.kill('SIGTERM')
            killTimer = setTimeout(() => {
              didKill = true
              child.kill('SIGKILL')
            }, KILL_GRACE_MS)
          }, timeoutMs)

    const clear = () => {
      if (timeout) clearTimeout(timeout)
      if (killTimer) clearTimeout(killTimer)
      stdoutFile?.end()
      stderrFile?.end()
    }

    const rejectWith = ({ code, reason }: { code: number | null; reason: string }) => {
      if (didReject) return
      didReject = true
      reject(
        new BinaryExecutionError({
          command,
          code,
          stdout,
          stderr,
          stdoutPath,
          stderrPath,
          reason
        })
      )
    }

    stdoutFile?.on('error', () => {
      child.kill('SIGTERM')
      rejectWith({ code: null, reason: 'stdout_spool_error' })
    })
    stderrFile?.on('error', () => {
      child.kill('SIGTERM')
      rejectWith({ code: null, reason: 'stderr_spool_error' })
    })

    if (input !== undefined) {
      // 읽는 쪽이 먼저 죽으면 EPIPE가 난다. 종료 처리는 close 핸들러가 하므로 여기서는 무시한다
      child.stdin.on('error', () => {})
      child.stdin.end(input)
    }

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stdout += text
      stdoutFile?.write(chunk)
      stdoutSplitter.push(text)
    })

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderr += text
      stderrFile?.write(chunk)
      stderrSplitter.push(text)
    })

    child.on('error', () => {
      clear()
      rejectWith({ code: null, reason: 'spawn_error' })
    })

    child.on('close', (code) => {
      clear()
      if (didTimeout) {
        rejectWith({
          code,
          reason: didKill ? `timeout_sigkill_${timeoutMs}ms` : `timeout_${timeoutMs}ms`
        })
        return
      }
      if (code === 0) {
        if (!didReject) resolve({ stdout, stderr })
        return
      }

      rejectWith({ code, reason: `exit_${code}` })
    })
  })
