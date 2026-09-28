import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { buildClaudeCliArgs, parseClaudeCliOutput } from '@shared/llm'
import { runBinary } from '../bin/spawn'
import { info, messageOf, warn } from '../log'

/**
 * Finder에서 띄운 앱의 PATH에는 `claude`가 없다 (references/pitfalls.md). 잘 알려진 설치 위치를
 * 먼저 보고, 없으면 로그인 셸에 한 번 물어 캐시한다.
 */
const CANDIDATE_PATHS = [
  path.join(os.homedir(), '.local', 'bin', 'claude'),
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
  path.join(os.homedir(), '.claude', 'local', 'claude')
]

const DEFAULT_SHELL = '/bin/zsh'
const CLAUDE_CLI_TIMEOUT_MS = 5 * 60 * 1000

interface ClaudeCliLocation {
  path: string | null
  version: string | null
}

let cachedLocation: ClaudeCliLocation | null = null
let cachedShellPath: string | null = null

/** 대화형 로그인 셸은 rc 파일의 출력이 섞일 수 있어 마지막 줄만 취한다 */
const lastLine = (text: string) => text.trim().split('\n').at(-1)?.trim() ?? ''

const askLoginShell = async (script: string) => {
  try {
    const { stdout } = await runBinary({
      command: process.env.SHELL || DEFAULT_SHELL,
      args: ['-ilc', script]
    })

    return lastLine(stdout)
  } catch (caught) {
    warn(`로그인 셸 조회 실패 (${script}): ${messageOf(caught)}`)
    return ''
  }
}

/** npm으로 설치한 claude는 `node`를 PATH에서 찾으므로 spawn 환경의 PATH를 로그인 셸 값으로 바꿔 준다 */
const shellPath = async () => {
  if (cachedShellPath) return cachedShellPath

  const found = await askLoginShell('printf %s "$PATH"')
  cachedShellPath = found || process.env.PATH || ''

  return cachedShellPath
}

const readVersion = async ({ command, env }: { command: string; env: NodeJS.ProcessEnv }) => {
  try {
    const { stdout } = await runBinary({ command, args: ['--version'], env })

    return lastLine(stdout) || null
  } catch (caught) {
    warn(`claude --version 실패: ${messageOf(caught)}`)
    return null
  }
}

const spawnEnv = async () => ({ ...process.env, PATH: await shellPath() })

/**
 * `claude` 실행 파일을 찾는다. 한 번 찾으면 앱이 살아 있는 동안 캐시하고,
 * 못 찾았으면 다음 조회에서 다시 찾는다 (사용자가 그 사이 설치할 수 있다).
 */
export const locateClaudeCli = async (): Promise<ClaudeCliLocation> => {
  if (cachedLocation?.path) return cachedLocation

  const candidate = CANDIDATE_PATHS.find((file) => existsSync(file))
  const found = candidate ?? (await askLoginShell('command -v claude'))
  if (!found || !existsSync(found)) {
    cachedLocation = { path: null, version: null }
    return cachedLocation
  }

  const version = await readVersion({ command: found, env: await spawnEnv() })
  cachedLocation = { path: found, version }
  info(`Claude Code 실행 파일: ${found} (${version ?? '버전 확인 실패'})`)

  return cachedLocation
}

interface CompleteWithClaudeCliParams {
  cliPath: string
  system: string
  prompt: string
  workDir: string
  label: string
}

/**
 * `claude -p`를 한 턴 돌려 답변만 돌려준다. 프롬프트는 stdin, 결과는 JSON 한 덩어리다
 * (references/architecture.md "Claude Code CLI 호출").
 */
export const completeWithClaudeCli = async ({
  cliPath,
  system,
  prompt,
  workDir,
  label
}: CompleteWithClaudeCliParams) => {
  await mkdir(workDir, { recursive: true })

  const { stdout } = await runBinary({
    command: cliPath,
    args: buildClaudeCliArgs({ system }),
    input: prompt,
    cwd: workDir,
    env: await spawnEnv(),
    timeoutMs: CLAUDE_CLI_TIMEOUT_MS,
    stdoutPath: path.join(workDir, `${label}.claude.stdout.json`),
    stderrPath: path.join(workDir, `${label}.claude.stderr.txt`)
  })

  return parseClaudeCliOutput(stdout)
}
