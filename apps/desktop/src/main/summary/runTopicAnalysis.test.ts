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

const v2Topic = ({
  sources,
  title = '녹음 파일 업로드와 처리 속도'
}: {
  sources: string[]
  title?: string
}) =>
  JSON.stringify({
    schemaVersion: 2,
    topics: [
      {
        documentId: null,
        domain: '프로덕트',
        title,
        summarySections: sources.map((sourceId, index) => ({
          heading: index === 0 ? '먼저 구현할 방식' : `핵심 ${index + 1}`,
          text: `${sourceId} 핵심`,
          sourceUtteranceIds: [sourceId]
        })),
        outline: [
          {
            heading: '논의 상세',
            items: sources.map((sourceId) => ({
              text: `${sourceId} 이유와 대안`,
              sourceUtteranceIds: [sourceId]
            }))
          }
        ]
      }
    ]
  })

const sourceIdsFromPrompt = (prompt: string) =>
  [...prompt.matchAll(/SOURCE_ID=(S\d+) \|/g)].map((match) => match[1])

const sourceIdsFromReducePrompt = (prompt: string) => {
  const payload = JSON.parse(
    prompt.split('## 구간별 분석\n')[1].split('\n\n## 출력 JSON 형식')[0]
  ) as {
    partials: Array<{
      topics: Array<{
        summarySections: Array<{ sourceUtteranceIds: string[] }>
        outline: Array<{ items: Array<{ sourceUtteranceIds: string[] }> }>
      }>
    }>
  }

  return [
    ...new Set(
      payload.partials.flatMap((partial) =>
        partial.topics.flatMap((topic) => [
          ...topic.summarySections.flatMap((section) => section.sourceUtteranceIds),
          ...topic.outline.flatMap((section) =>
            section.items.flatMap((item) => item.sourceUtteranceIds)
          )
        ])
      )
    )
  ]
}

describe('runTopicAnalysis', () => {
  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(os.tmpdir(), 'meeting-stt-ai-'))
    createLlmClient.mockReset()
  })

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true })
  })

  it('빈 전사는 provider 준비 여부를 확인하지 않고 V2 빈 결과 attempt를 남긴다', async () => {
    const { runTopicAnalysis } = await loadRunTopicAnalysis()

    const attempt = await runTopicAnalysis({
      meetingId: 'meeting-empty',
      utterances: [],
      documents: [],
      onProgress: vi.fn()
    })

    expect(createLlmClient).not.toHaveBeenCalled()
    expect(attempt.result).toEqual({ schemaVersion: 2, topics: [] })
    const [dir] = await attemptDirs('meeting-empty')
    const saved = JSON.parse(
      await readFile(
        path.join(rootDir, 'ai-attempts', 'meeting-empty', dir.name, 'attempt.json'),
        'utf8'
      )
    )
    expect(saved.result).toEqual({ schemaVersion: 2, topics: [] })
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
        utterances: [{ id: 'u1', speakerLabel: '화자 1', text: 'A를 이야기했습니다.' }],
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
      promptVersion: 'topic-analysis-v2',
      error: '모델 실패'
    })
    expect(failure.diagnostics).toBeUndefined()
  })

  it('로컬 분석에 JSON 문법과 넉넉한 출력 예산을 전달하고 잘린 원본도 남긴다', async () => {
    const complete = vi.fn().mockResolvedValue('{"schemaVersion":2,"topics":[')
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
        utterances: [{ id: 'u1', speakerLabel: '화자 1', text: '업로드를 논의합니다' }],
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
    expect(TOPIC_ANALYSIS_MAX_PREDICT_TOKENS).toBeGreaterThan(3000)
    const [dir] = await attemptDirs('cut-json')
    expect(
      await readFile(
        path.join(rootDir, 'ai-attempts', 'cut-json', dir.name, 'topic-whole.raw.txt'),
        'utf8'
      )
    ).toBe('{"schemaVersion":2,"topics":[')
  })

  it('결정 없는 정보 공유도 동적 heading과 상세 outline을 가진 새 문서로 확정한다', async () => {
    const complete = vi.fn<LlmClient['complete']>().mockResolvedValue(
      v2Topic({
        sources: ['S001', 'S002'],
        title: '녹음 파일 업로드와 처리 속도'
      })
    )
    createLlmClient.mockResolvedValue({
      provider: 'local',
      model: 'test',
      chunkBudgetChars: 9088,
      complete
    })
    const { runTopicAnalysis } = await loadRunTopicAnalysis()
    const attempt = await runTopicAnalysis({
      meetingId: 'no-decisions',
      documents: [{ id: 'old-doc', domain: '프로덕트', title: '프로덕트' }],
      onProgress: vi.fn(),
      utterances: [
        { id: 'u1', speakerLabel: '화자 1', text: '업로드 뒤 상태를 보여주면 좋겠습니다.' },
        { id: 'u2', speakerLabel: '화자 2', text: '파일 분할 전송도 아이디어로 나왔습니다.' }
      ]
    })

    expect(attempt.result.schemaVersion).toBe(2)
    if (attempt.result.schemaVersion !== 2) throw new Error('expected V2')
    expect(attempt.result.topics[0]).toMatchObject({
      domain: '프로덕트',
      title: '녹음 파일 업로드와 처리 속도'
    })
    expect(attempt.result.topics[0].documentId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
    expect(attempt.result.topics[0].documentId).not.toBe('old-doc')
    expect(attempt.result.topics[0].summarySections[0].heading).toBe('먼저 구현할 방식')
    expect(attempt.result.topics[0].outline[0].items[1].text).toContain('이유와 대안')
  })

  it('긴 전사와 도메인 목록을 함께 예산에 넣고 최종 결과의 모든 근거와 세부사항을 보존한다', async () => {
    const utterances = Array.from({ length: 12 }, (_, index) => ({
      id: `u${index}`,
      speakerLabel: '화자 1',
      text: `주제 ${index}의 이유와 대안을 공유합니다. `.repeat(30),
      startSec: index * 60
    }))
    const documents = Array.from({ length: 4 }, (_, index) => ({
      id: `domain-${index}`,
      domain: `도메인 ${index}`,
      title: `도메인 ${index}`
    }))
    const complete = vi.fn<LlmClient['complete']>().mockImplementation(async (params) => {
      expect(params.prompt.length + params.system.length).toBeLessThanOrEqual(
        TOPIC_ANALYSIS_LOCAL_INPUT_CHARS
      )
      const sources = params.label.startsWith('topic-reduce-')
        ? sourceIdsFromReducePrompt(params.prompt)
        : sourceIdsFromPrompt(params.prompt)
      return v2Topic({ sources })
    })
    createLlmClient.mockResolvedValue({
      provider: 'local',
      model: 'test',
      chunkBudgetChars: 6000,
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
    expect(attempt.result.schemaVersion).toBe(2)
    if (attempt.result.schemaVersion !== 2) throw new Error('expected V2')
    const preserved = new Set(
      attempt.result.topics.flatMap((topic) => [
        ...topic.summarySections.flatMap((section) => section.sourceUtteranceIds),
        ...topic.outline.flatMap((section) =>
          section.items.flatMap((item) => item.sourceUtteranceIds)
        )
      ])
    )
    expect(preserved.size).toBe(utterances.length)
    expect(
      complete.mock.calls.filter(([params]) => params.label.startsWith('topic-reduce-')).length
    ).toBeGreaterThan(0)
    expect(attempt.rawResponses.length).toBe(complete.mock.calls.length)
  })

  it('합치기에서 근거나 세부사항이 사라지면 구간 결과와 원본을 보존하고 최종 분석을 확정하지 않는다', async () => {
    const complete = vi
      .fn<LlmClient['complete']>()
      .mockImplementation(async (params) =>
        params.label.startsWith('topic-reduce-')
          ? v2Topic({ sources: ['S001'] })
          : v2Topic({ sources: sourceIdsFromPrompt(params.prompt) })
      )
    createLlmClient.mockResolvedValue({
      provider: 'local',
      model: 'test',
      chunkBudgetChars: 5000,
      complete
    })
    const { runTopicAnalysis } = await loadRunTopicAnalysis()
    await expect(
      runTopicAnalysis({
        meetingId: 'lost-detail',
        documents: [],
        onProgress: vi.fn(),
        utterances: [
          { id: 'u1', speakerLabel: '화자 1', text: '첫 번째 주제 회의. '.repeat(160) },
          { id: 'u2', speakerLabel: '화자 2', text: '두 번째 주제 회의. '.repeat(160) }
        ]
      })
    ).rejects.toThrow(/전체 주제 문서를 합치지 못했습니다.*근거가 누락/)
    const [dir] = await attemptDirs('lost-detail')
    const files = await readdir(path.join(rootDir, 'ai-attempts', 'lost-detail', dir.name))
    expect(files.filter((file) => file.endsWith('.partial.json'))).toHaveLength(2)
    expect(files).toContain('topic-reduce-0-0.raw.txt')
    expect(files).not.toContain('attempt.json')
  })
})
