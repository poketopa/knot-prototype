import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TopicAnalysisAttempt } from '@shared/types'

const state = vi.hoisted(() => ({
  root: '',
  owner: 'owner-a',
  analyze: vi.fn(),
  request: vi.fn(),
  model: 'test-model'
}))
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('./authState', () => ({
  requirePrototypeUser: () => ({ id: state.owner }),
  prototypeUserRoot: () => path.join(state.root, state.owner)
}))
vi.mock('../llm/provider', () => ({
  createLlmClient: async () => ({
    provider: 'local',
    model: state.model,
    chunkBudgetChars: 10000,
    complete: vi.fn()
  })
}))
vi.mock('../summary/run', () => ({ runTopicAnalysis: state.analyze }))
vi.mock('./apiClient', () => ({
  prototypeRequest: state.request,
  PrototypeApiError: class extends Error {
    status = 500
  }
}))

import { closeDb, getDb } from '../db/connection'
import { findPrototypeArtifact, registerPrototypeArtifact } from './artifacts'
import {
  choosePrototypeComparison,
  findPrototypeComparison,
  generatePrototypeComparison,
  getPrototypeComparison
} from './comparisons'
import { listPrototypeDocuments } from './documents'
import { listPrototypeProcessing } from './jobs'

const attempt = (variant: string): TopicAnalysisAttempt => ({
  id: `attempt-${variant}`,
  provider: 'local',
  model: 'test-model',
  promptVersion: `test-${variant}`,
  rawResponses: [{ label: 'whole', text: variant }],
  partialResults: [],
  result: {
    schemaVersion: 2,
    topics: [
      {
        documentId: `document-${variant}`,
        domain: '회의',
        title: `${variant} 문서`,
        summarySections: [
          { heading: '핵심 요약', text: `${variant} 요약`, sourceUtteranceIds: ['u1'] }
        ],
        outline: []
      }
    ]
  }
})
const generate = () =>
  generatePrototypeComparison({ recordingId: 'recording-1', onProgress: () => {} })
const choose = (selectedVariant: 'A' | 'B' = 'A') =>
  choosePrototypeComparison({
    recordingId: 'recording-1',
    selectedVariant,
    reason: 'decisions_actions',
    meetingType: 'multi_agenda'
  })
const publishRows = () =>
  getDb().prepare("SELECT payload_json FROM prototype_outbox WHERE kind='publish'").all() as Array<{
    payload_json: string
  }>

beforeEach(async () => {
  state.root = await mkdtemp(path.join(os.tmpdir(), 'knot-ab-'))
  state.owner = 'owner-a'
  state.model = 'test-model'
  state.request.mockReset().mockRejectedValue(new Error('offline'))
  state.analyze.mockReset().mockImplementation(async ({ variant }) => attempt(variant))
  getDb()
    .prepare(
      "INSERT INTO meetings (id,owner_id,title,created_at,duration_sec,status) VALUES ('recording-1','owner-a','회의',1,60,'done')"
    )
    .run()
  await registerPrototypeArtifact({
    recordingId: 'recording-1',
    kind: 'transcript',
    content: {
      schemaVersion: 1,
      utterances: [
        {
          id: 'u1',
          speakerLabel: '참여자 1',
          startSec: 0,
          text: '다음 주에 결정한다'
        }
      ]
    }
  })
})
afterEach(async () => {
  closeDb()
  await rm(state.root, { recursive: true, force: true })
})

describe('주제별 정리 비교와 선택', () => {
  it('동일 입력과 AI로 두 후보를 보관하고 선택 전에는 발행·문서 목록 노출을 하지 않는다', async () => {
    await generate()
    const calls = state.analyze.mock.calls.map(([input]) => input)
    expect(calls.map((input) => input.variant)).toEqual(['A', 'B'])
    expect(calls[0].utterances).toEqual(calls[1].utterances)
    expect(calls[0].documents).toEqual(calls[1].documents)
    expect(calls[0].client).toBe(calls[1].client)
    expect(
      getDb().prepare("SELECT id FROM prototype_artifacts WHERE kind='ai_analysis'").all()
    ).toHaveLength(2)
    expect(
      getDb().prepare("SELECT id FROM prototype_artifacts WHERE kind='ai_raw'").all()
    ).toHaveLength(2)
    expect(publishRows()).toHaveLength(0)
    expect(
      findPrototypeArtifact({ recordingId: 'recording-1', kind: 'ai_analysis' })
    ).toBeUndefined()
    expect(await listPrototypeDocuments()).toEqual([])
    expect(listPrototypeProcessing()[0]).toMatchObject({
      stage: 'choosing',
      status: 'pending',
      saved: false
    })
  })

  it('뒤에 생성된 B 대신 A를 골라도 A만 발행하며 두 후보와 배치를 계속 보존한다', async () => {
    await generate()
    const before = findPrototypeComparison('recording-1')!
    choose('A')
    const payload = JSON.parse(publishRows()[0].payload_json)
    expect(payload.analysisArtifactId).toBe(before.analysis_a_id)
    expect(findPrototypeArtifact({ recordingId: 'recording-1', kind: 'ai_analysis' })?.id).toBe(
      before.analysis_a_id
    )
    expect(payload.transcriptArtifactId).toBe(before.transcript_artifact_id)
    expect(payload.selection).toMatchObject({
      comparisonArtifactId: before.comparison_artifact_id,
      selectedVariant: 'A',
      reason: 'decisions_actions',
      meetingType: 'multi_agenda'
    })
    expect((await listPrototypeDocuments()).map((doc) => doc.id)).toEqual(['document-A'])
    expect(getPrototypeComparison({ recordingId: 'recording-1' })?.candidates).toHaveLength(2)
    closeDb()
    expect(getPrototypeComparison({ recordingId: 'recording-1' })?.firstVariant).toBe(
      before.first_variant
    )
    expect(findPrototypeComparison('recording-1')?.selection_json).toBeTruthy()
  })

  it('B 실패와 재시작 뒤 A·입력·좌우 배치를 재사용해 B만 재시도한다', async () => {
    state.analyze.mockImplementation(async ({ variant }) => {
      if (variant === 'B') throw new Error('AI 실패')
      return attempt(variant)
    })
    await expect(generate()).rejects.toThrow('AI 실패')
    const before = findPrototypeComparison('recording-1')!
    expect(before.analysis_a_id).toBeTruthy()
    expect(before.analysis_b_id).toBeNull()
    expect(publishRows()).toHaveLength(0)
    await registerPrototypeArtifact({
      recordingId: 'recording-1',
      kind: 'transcript',
      content: { schemaVersion: 1, utterances: [] }
    })
    closeDb()
    state.analyze.mockClear().mockImplementation(async ({ variant }) => attempt(variant))
    await generate()
    expect(state.analyze).toHaveBeenCalledTimes(1)
    expect(state.analyze.mock.calls[0][0]).toMatchObject({
      variant: 'B',
      utterances: [{ id: 'u1', text: '다음 주에 결정한다' }]
    })
    expect(findPrototypeComparison('recording-1')).toMatchObject({
      analysis_a_id: before.analysis_a_id,
      first_variant: before.first_variant,
      transcript_artifact_id: before.transcript_artifact_id
    })
  })

  it('완료하지 않은 비교에 다른 모델을 섞거나 후보가 하나일 때 선택하지 못한다', async () => {
    state.analyze.mockImplementation(async ({ variant }) => {
      if (variant === 'B') throw new Error('AI 실패')
      return attempt(variant)
    })
    await expect(generate()).rejects.toThrow()
    expect(() => choose()).toThrow('정리 두 개')
    state.model = 'different-model'
    await expect(generate()).rejects.toThrow('AI 설정이 다릅니다')
    expect(publishRows()).toHaveLength(0)
  })

  it('같은 선택 재전송은 한 번만 발행하고 다른 선택 및 필수 입력 누락을 거절한다', async () => {
    await generate()
    expect(() =>
      choosePrototypeComparison({
        recordingId: 'recording-1',
        selectedVariant: 'A',
        reason: '' as never,
        meetingType: 'multi_agenda'
      })
    ).toThrow('모두 골라')
    choose('B')
    choose('B')
    expect(publishRows()).toHaveLength(1)
    expect(() => choose('A')).toThrow('변경할 수 없습니다')
    expect((await listPrototypeDocuments()).map((doc) => doc.id)).toEqual(['document-B'])
  })

  it('다른 사용자에게 비교·선택을 노출하지 않는다', async () => {
    await generate()
    state.owner = 'owner-b'
    expect(getPrototypeComparison({ recordingId: 'recording-1' })).toBeNull()
    expect(() => choose()).toThrow('정리 두 개')
    state.owner = 'owner-a'
    expect(findPrototypeComparison('recording-1')?.selection_json).toBeNull()
  })

  it('발행 대기 저장 실패 시 선택도 함께 되돌려 다시 선택할 수 있다', async () => {
    await generate()
    getDb().exec(`CREATE TRIGGER reject_publish BEFORE INSERT ON prototype_outbox
      WHEN NEW.kind='publish' BEGIN SELECT RAISE(ABORT,'injected publish failure'); END;`)
    expect(() => choose()).toThrow('injected publish failure')
    expect(findPrototypeComparison('recording-1')?.selection_json).toBeNull()
    expect(publishRows()).toHaveLength(0)
    getDb().exec('DROP TRIGGER reject_publish')
    choose()
    expect(publishRows()).toHaveLength(1)
  })
})
