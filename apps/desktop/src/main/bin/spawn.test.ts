import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { BinaryExecutionError, runBinary } from './spawn'

let dir = ''

describe('runBinary', () => {
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'meeting-stt-spawn-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('nonzero exit에서도 stdout/stderr partial을 파일에 남긴다', async () => {
    const stdoutPath = path.join(dir, 'stdout.txt')
    const stderrPath = path.join(dir, 'stderr.txt')

    await expect(
      runBinary({
        command: process.execPath,
        args: [
          '-e',
          'process.stdout.write("partial-out"); process.stderr.write("partial-err"); process.exit(7)'
        ],
        stdoutPath,
        stderrPath
      })
    ).rejects.toMatchObject({
      name: 'BinaryExecutionError',
      code: 7,
      stdoutPath,
      stderrPath
    })

    await expect(readFile(stdoutPath, 'utf8')).resolves.toBe('partial-out')
    await expect(readFile(stderrPath, 'utf8')).resolves.toBe('partial-err')
  })

  it('timeout에서도 이미 나온 stdout을 보존한다', async () => {
    const stdoutPath = path.join(dir, 'timeout-stdout.txt')

    await expect(
      runBinary({
        command: process.execPath,
        args: ['-e', 'process.stdout.write("before-timeout"); setTimeout(() => {}, 10000)'],
        stdoutPath,
        // 병렬 테스트 중 Node 기동 시간과 검증하려는 실행 시간 초과를 구분한다.
        timeoutMs: 1000
      })
    ).rejects.toBeInstanceOf(BinaryExecutionError)

    await expect(readFile(stdoutPath, 'utf8')).resolves.toBe('before-timeout')
  })
})
