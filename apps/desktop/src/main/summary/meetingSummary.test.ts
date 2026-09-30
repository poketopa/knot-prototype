import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TopicAnalysisResult } from '@shared/types'
import type { LlmClient } from '../llm/types'

let rootDir = ''
const createLlmClient = vi.fn<() => Promise<LlmClient>>()
vi.mock('../llm/provider', () => ({ createLlmClient }))
vi.mock('../prototype/authState', () => ({ prototypeUserRoot: () => rootDir }))

const topic = (title: string) => ({
  existingDocumentId: null,
  newDocumentId: null,
  title,
  overview: `${title} 관련 진행 상황을 검토했습니다.`,
  decisions: [],
  unresolved: []
})

describe('meeting-wide summary', () => {
  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(os.tmpdir(), 'knot-meeting-summary-'))
    createLlmClient.mockReset()
  })

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true })
  })

  it('빈 분석에는 모델을 부르거나 내용을 만들어 넣지 않는다', async () => {
    const { createMeetingSummary } = await import('./meetingSummary')
    const result = await createMeetingSummary({
      recordingId: 'empty',
      analysis: { schemaVersion: 1, topics: [] }
    })
    expect(result.content).toEqual({ schemaVersion: 1, headline: '', body: '' })
    expect(createLlmClient).not.toHaveBeenCalled()
  })

  it('긴 회의는 모든 구간을 읽고 마지막 결과를 원문과 함께 보관한다', async () => {
    const calls: string[] = []
    createLlmClient.mockResolvedValue({
      provider: 'local',
      model: 'test',
      chunkBudgetChars: 900,
      complete: vi.fn(async ({ prompt }: { prompt: string }) => {
        calls.push(prompt)
        const labels = [...new Set(prompt.match(/주제\d+/g) ?? [])].join(',')
        return `핵심: ${labels}\n정리: ${labels} 내용을 검토했습니다.`
      })
    })
    const { createMeetingSummary } = await import('./meetingSummary')
    const analysis: TopicAnalysisResult = {
      schemaVersion: 1,
      topics: Array.from({ length: 30 }, (_, index) => topic(`주제${index}`))
    }
    const result = await createMeetingSummary({ recordingId: 'long', analysis })
    expect(calls.length).toBeGreaterThan(1)
    expect(result.content.body).toContain('주제0')
    expect(result.content.body).toContain('주제29')
    expect(result.rawResponses).toHaveLength(calls.length)
    const [attemptDir] = await readdir(path.join(rootDir, 'meeting-summaries', 'long'))
    expect(
      await readFile(
        path.join(
          rootDir,
          'meeting-summaries',
          'long',
          attemptDir,
          `${result.rawResponses[0].label}.raw.txt`
        ),
        'utf8'
      )
    ).toBe(result.rawResponses[0].text)
  })

  it('모델이 형식을 어기면 빈 요약을 성공으로 표시하지 않는다', async () => {
    createLlmClient.mockResolvedValue({
      provider: 'local',
      model: 'test',
      chunkBudgetChars: 1400,
      complete: vi.fn().mockResolvedValue('분석할 수 없습니다')
    })
    const { createMeetingSummary } = await import('./meetingSummary')
    await expect(
      createMeetingSummary({
        recordingId: 'bad',
        analysis: { schemaVersion: 1, topics: [topic('안건')] }
      })
    ).rejects.toThrow(/형식/)
  })

  it('전사 원문을 우선 읽고 내용에 맞춰 여러 문단을 보존한다', async () => {
    const complete = vi
      .fn()
      .mockResolvedValue(
        '핵심: 출시 준비의 걸림돌을 확인했습니다.\n정리: 첫 논의에서는 접근 권한을 확인했습니다.\n\n이후 테스트 절차와 일정 사이의 관계를 검토했습니다.'
      )
    createLlmClient.mockResolvedValue({
      provider: 'local',
      model: 'test',
      chunkBudgetChars: 3000,
      complete
    })
    const { createMeetingSummary } = await import('./meetingSummary')
    const result = await createMeetingSummary({
      recordingId: 'transcript',
      analysis: { schemaVersion: 1, topics: [topic('분석 제목')] },
      utterances: [
        { speakerLabel: '화자 1', startSec: 12, text: '접근 권한부터 확인합시다.' },
        { speakerLabel: '화자 2', startSec: 83, text: '테스트 절차도 필요합니다.' }
      ]
    })
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('접근 권한부터 확인합시다.'),
        maxTokens: 1200
      })
    )
    expect(complete.mock.calls[0][0].prompt).not.toContain('분석 제목')
    expect(result.content.body).toContain('\n\n')
    expect(result.rawResponses).toHaveLength(1)
  })
})
