import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../bin/spawn', async () => {
  const actual = await vi.importActual<typeof import('../bin/spawn')>('../bin/spawn')

  return { ...actual, runBinary: vi.fn() }
})
vi.mock('../log', () => ({ info: vi.fn(), warn: vi.fn(), messageOf: String }))

import { BinaryExecutionError, runBinary } from '../bin/spawn'
import { completeWithClaudeCli } from './claudeCli'

let dir = ''

const shellPathResult = { stdout: '/opt/homebrew/bin:/usr/bin', stderr: '' }

describe('completeWithClaudeCli', () => {
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'meeting-stt-claude-cli-'))
    vi.clearAllMocks()
    vi.mocked(runBinary).mockResolvedValue(shellPathResult)
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('nonzero exit에서도 BinaryExecutionError 진단 경로를 보존하고 로그인 안내를 보여 준다', async () => {
    const stdoutPath = path.join(dir, 'topic.claude.stdout.json')
    const stderrPath = path.join(dir, 'topic.claude.stderr.txt')
    vi.mocked(runBinary).mockImplementation(async ({ args }) => {
      if (args[0] === '-ilc') return shellPathResult

      throw new BinaryExecutionError({
        command: '/Users/me/.local/bin/claude',
        code: 1,
        stdout: '{"is_error":true,"result":"Not logged in · Please run /login","type":"result"}',
        stderr: '',
        stdoutPath,
        stderrPath,
        reason: 'exit_1'
      })
    })

    await expect(
      completeWithClaudeCli({
        cliPath: '/Users/me/.local/bin/claude',
        system: 'system',
        prompt: 'prompt',
        workDir: dir,
        label: 'topic'
      })
    ).rejects.toMatchObject({
      name: 'BinaryExecutionError',
      code: 1,
      stdoutPath,
      stderrPath,
      message: expect.stringMatching(/로그인/)
    })
  })

  it('지원하지 않는 CLI 옵션 오류를 업데이트 안내로 바꾼다', async () => {
    vi.mocked(runBinary).mockImplementation(async ({ args }) => {
      if (args[0] === '-ilc') return shellPathResult

      throw new BinaryExecutionError({
        command: '/Users/me/.local/bin/claude',
        code: 1,
        stdout: '',
        stderr: 'error: unknown option --safe-mode',
        reason: 'exit_1'
      })
    })

    await expect(
      completeWithClaudeCli({
        cliPath: '/Users/me/.local/bin/claude',
        system: 'system',
        prompt: 'prompt',
        workDir: dir,
        label: 'topic'
      })
    ).rejects.toMatchObject({
      name: 'BinaryExecutionError',
      message: expect.stringMatching(/최신 버전/)
    })
  })
})
