import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmClient } from '../llm/types'

let rootDir = ''
const createLlmClient = vi.fn<() => Promise<LlmClient>>()

vi.mock('../llm/provider', () => ({ createLlmClient }))
vi.mock('../prototype/authState', () => ({ prototypeUserRoot: () => rootDir }))
vi.mock('../log', () => ({
  info: vi.fn(),
  messageOf: (caught: unknown) => (caught instanceof Error ? caught.message : String(caught))
}))

const loadRunTopicAnalysis = async () => {
  vi.resetModules()
  return import('./run')
}

const attemptDirs = async (meetingId: string) =>
  readdir(path.join(rootDir, 'ai-attempts', meetingId), { withFileTypes: true })

describe('runTopicAnalysis', () => {
  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(os.tmpdir(), 'meeting-stt-ai-'))
    createLlmClient.mockReset()
  })

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true })
  })

  it('빈 전사는 provider 준비 여부를 확인하지 않고 빈 결과 attempt를 남긴다', async () => {
    const { runTopicAnalysis } = await loadRunTopicAnalysis()

    const attempt = await runTopicAnalysis({
      meetingId: 'meeting-empty',
      utterances: [],
      documents: [],
      onProgress: vi.fn()
    })

    expect(createLlmClient).not.toHaveBeenCalled()
    expect(attempt.result).toEqual({ schemaVersion: 1, topics: [] })
    const [dir] = await attemptDirs('meeting-empty')
    const saved = JSON.parse(
      await readFile(
        path.join(rootDir, 'ai-attempts', 'meeting-empty', dir.name, 'attempt.json'),
        'utf8'
      )
    )
    expect(saved.result.topics).toEqual([])
  })

  it('provider 실패도 failure spool을 남긴다', async () => {
    createLlmClient.mockResolvedValue({
      provider: 'local',
      model: 'test-model',
      chunkBudgetChars: 1000,
      complete: vi.fn().mockRejectedValue(new Error('모델 실패'))
    })
    const { runTopicAnalysis } = await loadRunTopicAnalysis()

    await expect(
      runTopicAnalysis({
        meetingId: 'meeting-fail',
        utterances: [{ id: 'u1', speakerLabel: '화자 1', text: 'A를 결정했습니다.' }],
        documents: [],
        onProgress: vi.fn()
      })
    ).rejects.toThrow(/모델 실패/)

    const [dir] = await attemptDirs('meeting-fail')
    const failure = JSON.parse(
      await readFile(
        path.join(rootDir, 'ai-attempts', 'meeting-fail', dir.name, 'topic-whole.failure.json'),
        'utf8'
      )
    )
    expect(failure).toMatchObject({
      provider: 'local',
      model: 'test-model',
      promptVersion: 'topic-analysis-v1',
      error: '모델 실패'
    })
    expect(failure.diagnostics).toBeUndefined()
  })
})
