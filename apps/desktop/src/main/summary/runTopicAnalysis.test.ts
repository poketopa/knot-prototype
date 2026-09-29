import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmClient } from '../llm/types'
import {
  TOPIC_ANALYSIS_JSON_GRAMMAR,
  TOPIC_ANALYSIS_LOCAL_INPUT_CHARS,
  TOPIC_ANALYSIS_MAX_PREDICT_TOKENS
} from '@shared/summary'

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
      chunkBudgetChars: 3000,
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

  it('로컬 분석에 JSON 문법과 별도 출력 예산을 전달하고 잘린 원본도 남긴다', async () => {
    const complete = vi.fn().mockResolvedValue('{"schemaVersion":1,"topics":[')
    createLlmClient.mockResolvedValue({
      provider: 'local',
      model: 'test',
      chunkBudgetChars: 9088,
      complete
    })
    const { runTopicAnalysis } = await loadRunTopicAnalysis()
    await expect(
      runTopicAnalysis({
        meetingId: 'cut-json',
        utterances: [{ id: 'u1', speakerLabel: '화자 1', text: '결정합니다' }],
        documents: [],
        onProgress: vi.fn()
      })
    ).rejects.toThrow(/끝까지 생성되지/)
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        grammar: TOPIC_ANALYSIS_JSON_GRAMMAR,
        maxTokens: TOPIC_ANALYSIS_MAX_PREDICT_TOKENS
      })
    )
    const [dir] = await attemptDirs('cut-json')
    expect(
      await readFile(
        path.join(rootDir, 'ai-attempts', 'cut-json', dir.name, 'topic-whole.raw.txt'),
        'utf8'
      )
    ).toBe('{"schemaVersion":1,"topics":[')
    expect(
      JSON.parse(
        await readFile(
          path.join(rootDir, 'ai-attempts', 'cut-json', dir.name, 'topic-whole.failure.json'),
          'utf8'
        )
      ).error
    ).toMatch(/끝까지 생성되지/)
  })

  it('긴 전사와 문서 목록을 함께 예산에 넣고 큰 최종 결과의 모든 근거를 보존한다', async () => {
    const utterances = Array.from({ length: 150 }, (_, index) => ({
      id: `u${index}`,
      speakerLabel: '화자 1',
      text: `주제 ${index} 결정과 미결정 사항을 논의합니다. `.repeat(20),
      startSec: index * 60
    }))
    const documents = Array.from({ length: 10 }, (_, index) => ({
      id: `doc-${index}`,
      title: `기존 주제 ${index}`,
      overview: '이전 회의 결정 내용을 기록합니다. '.repeat(5)
    }))
    const complete = vi.fn<LlmClient['complete']>().mockImplementation(async (params) => {
      expect(params.prompt.length + params.system.length).toBeLessThanOrEqual(
        TOPIC_ANALYSIS_LOCAL_INPUT_CHARS
      )
      const sources = params.label.startsWith('topic-reduce-')
        ? [
            ...new Set(
              (
                JSON.parse(
                  params.prompt.split('## 구간별 분석\n')[1].split('\n\n## 출력 JSON 형식')[0]
                ) as { partials: { topics: { decisions: { sourceUtteranceIds: string[] }[] }[] }[] }
              ).partials.flatMap((partial) =>
                partial.topics.flatMap((topic) =>
                  topic.decisions.flatMap((point) => point.sourceUtteranceIds)
                )
              )
            )
          ]
        : [...params.prompt.matchAll(/SOURCE_ID=(S\d+) \|/g)].map((match) => match[1])
      return JSON.stringify({
        schemaVersion: 1,
        topics: [
          {
            existingDocumentId: null,
            newDocumentId: null,
            title: '배포 계획',
            overview: '배포를 논의했습니다.',
            decisions: [{ text: '배포를 진행한다', sourceUtteranceIds: sources }],
            unresolved: []
          }
        ]
      })
    })
    createLlmClient.mockResolvedValue({
      provider: 'local',
      model: 'test',
      chunkBudgetChars: 9088,
      complete
    })
    const { runTopicAnalysis } = await loadRunTopicAnalysis()
    const attempt = await runTopicAnalysis({
      meetingId: 'long',
      utterances,
      documents,
      onProgress: vi.fn()
    })
    expect(attempt.partialResults.length).toBeGreaterThan(1)
    expect(attempt.result.topics).toHaveLength(1)
    const preserved = new Set(
      attempt.result.topics.flatMap((topic) =>
        topic.decisions.flatMap((point) => point.sourceUtteranceIds)
      )
    )
    expect(preserved.size).toBe(utterances.length)
    expect(
      complete.mock.calls.filter(([params]) => params.label.startsWith('topic-reduce-')).length
    ).toBeGreaterThan(1)
    expect(attempt.rawResponses.length).toBe(complete.mock.calls.length)
  })

  it('뒤 구간에서 확정된 미결정은 이전과 최종 근거를 모두 묶어 결정으로 정리한다', async () => {
    const complete = vi.fn<LlmClient['complete']>().mockImplementation(async (params) => {
      const reducing = params.label.startsWith('topic-reduce-')
      if (reducing)
        expect(params.prompt).toContain('이전 논의와 최종 결정의 모든 sourceUtteranceIds')
      const decided = reducing || params.label === 'topic-chunk-1'
      const point = {
        text: decided ? 'Postgres를 사용한다' : 'DB 선택을 검토한다',
        sourceUtteranceIds: reducing ? ['S001', 'S002'] : ['S001']
      }
      return JSON.stringify({
        schemaVersion: 1,
        topics: [
          {
            existingDocumentId: null,
            newDocumentId: null,
            title: 'DB 선택',
            overview: 'DB를 검토했다',
            decisions: decided ? [point] : [],
            unresolved: decided ? [] : [point]
          }
        ]
      })
    })
    createLlmClient.mockResolvedValue({
      provider: 'local',
      model: 'test',
      chunkBudgetChars: 2200,
      complete
    })
    const { runTopicAnalysis } = await loadRunTopicAnalysis()
    const attempt = await runTopicAnalysis({
      meetingId: 'resolved-later',
      documents: [],
      onProgress: vi.fn(),
      utterances: [
        { id: 'proposal', speakerLabel: '화자 1', text: 'DB는 더 검토한다. '.repeat(45) },
        { id: 'decision', speakerLabel: '화자 1', text: 'Postgres를 선택한다. '.repeat(45) }
      ]
    })
    expect(attempt.partialResults).toHaveLength(2)
    expect(attempt.result.topics[0].unresolved).toEqual([])
    expect(attempt.result.topics[0].decisions[0].sourceUtteranceIds).toEqual([
      'proposal',
      'decision'
    ])
  })

  it('합치기에서 근거가 사라지면 구간 결과와 원본을 보존하고 최종 분석을 확정하지 않는다', async () => {
    const complete = vi.fn<LlmClient['complete']>().mockImplementation(async (params) =>
      params.label.startsWith('topic-reduce-')
        ? '{"schemaVersion":1,"topics":[]}'
        : JSON.stringify({
            schemaVersion: 1,
            topics: [
              {
                existingDocumentId: null,
                newDocumentId: null,
                title: 'DB',
                overview: '검토',
                decisions: [{ text: '결정', sourceUtteranceIds: ['S001'] }],
                unresolved: []
              }
            ]
          })
    )
    createLlmClient.mockResolvedValue({
      provider: 'local',
      model: 'test',
      chunkBudgetChars: 2200,
      complete
    })
    const { runTopicAnalysis } = await loadRunTopicAnalysis()
    await expect(
      runTopicAnalysis({
        meetingId: 'lost-evidence',
        documents: [],
        onProgress: vi.fn(),
        utterances: [
          { id: 'u1', speakerLabel: '화자 1', text: 'DB는 더 검토한다. '.repeat(45) },
          { id: 'u2', speakerLabel: '화자 1', text: 'Postgres를 선택한다. '.repeat(45) }
        ]
      })
    ).rejects.toThrow(/전체 결정을 합치지 못했습니다.*근거가 누락/)
    const [dir] = await attemptDirs('lost-evidence')
    const files = await readdir(path.join(rootDir, 'ai-attempts', 'lost-evidence', dir.name))
    expect(files.filter((file) => file.endsWith('.partial.json'))).toHaveLength(2)
    expect(files).toContain('topic-reduce-0-0.raw.txt')
    expect(files).not.toContain('attempt.json')
  })

  it('같은 발화를 근거로 삼은 결정 두 개 중 하나가 사라져도 최종 분석을 확정하지 않는다', async () => {
    const complete = vi.fn<LlmClient['complete']>().mockImplementation(async (params) =>
      JSON.stringify({
        schemaVersion: 1,
        topics: [
          {
            existingDocumentId: null,
            newDocumentId: null,
            title: '배포',
            overview: '검토',
            decisions: params.label.startsWith('topic-reduce-')
              ? [{ text: '첫 번째 결정', sourceUtteranceIds: ['S001', 'S002'] }]
              : [
                  { text: '첫 번째 결정', sourceUtteranceIds: ['S001'] },
                  { text: '두 번째 결정', sourceUtteranceIds: ['S001'] }
                ],
            unresolved: []
          }
        ]
      })
    )
    createLlmClient.mockResolvedValue({
      provider: 'local',
      model: 'test',
      chunkBudgetChars: 2200,
      complete
    })
    const { runTopicAnalysis } = await loadRunTopicAnalysis()
    await expect(
      runTopicAnalysis({
        meetingId: 'lost-decision',
        documents: [],
        onProgress: vi.fn(),
        utterances: [
          { id: 'u1', speakerLabel: '화자 1', text: '첫 번째 주제 회의. '.repeat(45) },
          { id: 'u2', speakerLabel: '화자 2', text: '두 번째 주제 회의. '.repeat(45) }
        ]
      })
    ).rejects.toThrow(/결정 사항이 누락/)
  })
})
