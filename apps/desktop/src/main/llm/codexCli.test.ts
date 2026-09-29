import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({ existsSync: vi.fn(() => true) }))
vi.mock('../bin/spawn', () => ({ runBinary: vi.fn() }))
vi.mock('../log', () => ({ info: vi.fn(), warn: vi.fn(), messageOf: String }))

import { runBinary } from '../bin/spawn'

const FEATURES = [
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
const HELP =
  '--sandbox read-only --ephemeral --ignore-user-config --ignore-rules --output-schema --skip-git-repo-check'

const locateWith = async (features: string, help = HELP) => {
  vi.mocked(runBinary).mockImplementation(async ({ args }) => ({
    stdout:
      args[0] === '--version'
        ? 'codex-cli 0.149.1\n'
        : args[0] === 'exec'
          ? help
          : args[0] === 'features'
            ? features
            : '/opt/homebrew/bin:/usr/bin',
    stderr: ''
  }))
  const { locateCodexCli } = await import('./codexCli')
  return locateCodexCli()
}

describe('Codex CLI capability detection', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it.each(['stable', 'under development', 'deprecated'])(
    'accepts disabled features with a %s stage',
    async (stage) => {
      const result = await locateWith(FEATURES.map((name) => `${name}\t${stage}\tfalse`).join('\n'))
      expect(result.isSandboxSupported).toBe(true)
      expect(result.unsupportedReason).toBeNull()
    }
  )

  it('accepts padded columns and CRLF output', async () => {
    const result = await locateWith(
      FEATURES.map((name) => `${name}    under development  false  \r`).join('\n')
    )
    expect(result.isSandboxSupported).toBe(true)
  })

  it.each([
    ['enabled', 'shell_tool stable true'],
    ['missing', ''],
    ['different name', 'other_shell_tool stable false'],
    ['split across lines', 'shell_tool\nstable false'],
    ['unexpected suffix', 'shell_tool stable false extra']
  ])('rejects a required feature that is %s', async (_, firstRow) => {
    const rows = [firstRow, ...FEATURES.slice(1).map((name) => `${name} stable false`)]
    expect((await locateWith(rows.join('\n'))).isSandboxSupported).toBe(false)
  })

  it('still requires all isolation options', async () => {
    const rows = FEATURES.map((name) => `${name} stable false`).join('\n')
    expect(
      (await locateWith(rows, HELP.replace('--ignore-user-config', ''))).isSandboxSupported
    ).toBe(false)
  })
})
