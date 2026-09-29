import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runBinary } from '../bin/spawn'
import { info, messageOf, warn } from '../log'

const CANDIDATE_PATHS = [
  '/opt/homebrew/bin/codex',
  '/usr/local/bin/codex',
  path.join(os.homedir(), '.local', 'bin', 'codex')
]

const DEFAULT_SHELL = '/bin/zsh'
const CODEX_CLI_TIMEOUT_MS = 5 * 60 * 1000
const DISABLED_FEATURES = [
  'shell_tool',
  'browser_use',
  'browser_use_external',
  'computer_use',
  'standalone_web_search',
  'web_search_cached',
  'web_search_request',
  'mcp_2026_07_28',
  'enable_mcp_apps',
  'skill_search',
  'tool_suggest'
]

interface CodexCliLocation {
  path: string | null
  version: string | null
  isSandboxSupported: boolean
  unsupportedReason: string | null
}

let cachedLocation: CodexCliLocation | null = null
let cachedShellPath: string | null = null

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

const shellPath = async () => {
  if (cachedShellPath) return cachedShellPath

  const found = await askLoginShell('printf %s "$PATH"')
  cachedShellPath = found || process.env.PATH || ''

  return cachedShellPath
}

const spawnEnv = async () => ({ ...process.env, PATH: await shellPath() })

const sanitizedSpawnEnv = async () => {
  const allowed = new Set([
    'CODEX_HOME',
    'HOME',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'LOGNAME',
    'PATH',
    'SHELL',
    'TMPDIR',
    'USER',
    'XDG_CONFIG_HOME',
    'XDG_CACHE_HOME',
    'XDG_DATA_HOME'
  ])
  const env: NodeJS.ProcessEnv = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (!value || !allowed.has(key)) continue
    if (key.startsWith('AWS') || key.includes('MCP')) continue
    env[key] = value
  }

  env.PATH = await shellPath()

  return env
}

const readVersion = async ({ command, env }: { command: string; env: NodeJS.ProcessEnv }) => {
  try {
    const { stdout } = await runBinary({ command, args: ['--version'], env })

    return lastLine(stdout) || null
  } catch (caught) {
    warn(`codex --version 실패: ${messageOf(caught)}`)
    return null
  }
}

const readExecHelp = async ({ command, env }: { command: string; env: NodeJS.ProcessEnv }) => {
  try {
    const { stdout } = await runBinary({ command, args: ['exec', '--help'], env })

    return stdout
  } catch (caught) {
    warn(`codex exec --help 실패: ${messageOf(caught)}`)
    return ''
  }
}

const readDisabledFeatures = async ({
  command,
  env
}: {
  command: string
  env: NodeJS.ProcessEnv
}) => {
  try {
    const { stdout } = await runBinary({
      command,
      args: ['features', 'list', ...DISABLED_FEATURES.flatMap((feature) => ['--disable', feature])],
      env
    })

    return stdout
  } catch (caught) {
    warn(`codex features list 실패: ${messageOf(caught)}`)
    return ''
  }
}

const isFeatureDisabled = ({ features, name }: { features: string; name: string }) =>
  features.split(/\r?\n/).some((line) => {
    const columns = line.trim().split(/\s+/)
    // The stage column can contain spaces, for example "under development".
    return columns.length >= 3 && columns[0] === name && columns.at(-1) === 'false'
  })

const assessSandboxSupport = ({ help, features }: { help: string; features: string }) => {
  const hasReadOnlySandbox = help.includes('--sandbox') && help.includes('read-only')
  const hasEphemeral = help.includes('--ephemeral')
  const hasIgnoreUserConfig = help.includes('--ignore-user-config')
  const hasIgnoreRules = help.includes('--ignore-rules')
  const hasOutputSchema = help.includes('--output-schema')
  const hasSkipGitRepoCheck = help.includes('--skip-git-repo-check')
  const disabled = DISABLED_FEATURES.filter((feature) =>
    isFeatureDisabled({ features, name: feature })
  )

  if (
    hasReadOnlySandbox &&
    hasEphemeral &&
    hasIgnoreUserConfig &&
    hasIgnoreRules &&
    hasOutputSchema &&
    hasSkipGitRepoCheck &&
    DISABLED_FEATURES.every((feature) => disabled.includes(feature))
  ) {
    return { isSupported: true, reason: null }
  }

  return {
    isSupported: false,
    reason:
      '현재 codex exec에서 회의록 입력 중 도구 기능을 모두 끄는 실행 구성을 확인하지 못했습니다'
  }
}

export const locateCodexCli = async (): Promise<CodexCliLocation> => {
  if (cachedLocation?.path) return cachedLocation

  const candidate = CANDIDATE_PATHS.find((file) => existsSync(file))
  const found = candidate ?? (await askLoginShell('command -v codex'))
  if (!found || !existsSync(found)) {
    cachedLocation = {
      path: null,
      version: null,
      isSandboxSupported: false,
      unsupportedReason: 'Codex CLI(codex 명령)를 찾을 수 없습니다'
    }
    return cachedLocation
  }

  const env = await spawnEnv()
  const [version, execHelp, disabledFeatures] = await Promise.all([
    readVersion({ command: found, env }),
    readExecHelp({ command: found, env }),
    readDisabledFeatures({ command: found, env })
  ])
  const support = assessSandboxSupport({ help: execHelp, features: disabledFeatures })
  cachedLocation = {
    path: found,
    version,
    isSandboxSupported: support.isSupported,
    unsupportedReason: support.reason
  }
  info(`Codex CLI 실행 파일: ${found} (${version ?? '버전 확인 실패'})`)

  return cachedLocation
}

const codexExecArgs = ({ outputPath }: { outputPath: string }) => [
  'exec',
  '--ignore-user-config',
  '--ignore-rules',
  '--ephemeral',
  '--skip-git-repo-check',
  '-c',
  'web_search="disabled"',
  '--sandbox',
  'read-only',
  ...DISABLED_FEATURES.flatMap((feature) => ['--disable', feature]),
  '-o',
  outputPath,
  '-'
]

export const completeWithCodexCli = async ({
  cliPath,
  system,
  prompt,
  workDir,
  label
}: {
  cliPath: string
  system: string
  prompt: string
  workDir: string
  label: string
}): Promise<string> => {
  const outputPath = path.join(workDir, `${label}.codex.out.txt`)
  const input = [
    system,
    '',
    '아래 사용자 입력에 답하세요. 도구를 사용하지 말고 최종 답변 본문만 출력하세요.',
    '',
    prompt
  ].join('\n')

  await runBinary({
    command: cliPath,
    args: codexExecArgs({ outputPath }),
    input,
    cwd: workDir,
    env: await sanitizedSpawnEnv(),
    timeoutMs: CODEX_CLI_TIMEOUT_MS,
    stdoutPath: path.join(workDir, `${label}.codex.stdout.txt`),
    stderrPath: path.join(workDir, `${label}.codex.stderr.txt`)
  })

  return (await readFile(outputPath, 'utf8')).trim()
}
