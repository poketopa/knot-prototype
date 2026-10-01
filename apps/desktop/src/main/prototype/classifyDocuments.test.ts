import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({
  root: '',
  owner: 'user',
  request: vi.fn(),
  complete: vi.fn(),
  busy: false
}))
vi.mock('./authState', () => ({
  requirePrototypeUser: () => ({ id: state.owner }),
  prototypeUserRoot: () => path.join(state.root, state.owner)
}))
vi.mock('./apiClient', () => ({
  prototypeRequest: state.request,
  PrototypeApiError: class extends Error {
    status = 500
  }
}))
vi.mock('./events', () => ({ emitPrototypeChanged: vi.fn() }))
vi.mock('../llm/provider', () => ({
  createLlmClient: async () => ({
    provider: 'codex-cli',
    model: 'test',
    chunkBudgetChars: 20000,
    complete: state.complete
  })
}))
vi.mock('../audio/session', () => ({ isRecordingBusy: () => state.busy }))
vi.mock('../pipeline/queue', () => ({ isPipelineQueueBusy: () => false }))
import {
  getDocumentClassificationState,
  isDocumentClassificationBusy,
  readClassificationAssignments,
  startDocumentClassification
} from './classifyDocuments'
const docs = [
  {
    id: 'doc-a',
    title: 'E2E 테스트 전략',
    domain: 'E2E 테스트 전략',
    overview: '전체 흐름을 테스트합니다.',
    body: { text: '개발 테스트의 배경과 이유' }
  },
  {
    id: 'doc-b',
    title: '책에서 배우는 관점',
    domain: '책에서 배우는 관점',
    body: { text: '독서 경험과 생각' }
  }
]
const valid = JSON.stringify({
  assignments: [
    { id: 'D0', domain: '소프트웨어 개발' },
    { id: 'D1', domain: '책과 문화' }
  ]
})
beforeEach(async () => {
  state.root = await mkdtemp(path.join(os.tmpdir(), 'knot-classify-'))
  state.owner = 'user'
  state.busy = false
  state.request.mockReset()
  state.complete.mockReset()
  state.complete.mockResolvedValue(valid)
})
afterEach(async () => {
  await vi.waitFor(() => expect(isDocumentClassificationBusy()).toBe(false))
  await rm(state.root, { recursive: true, force: true })
})
it('본문/제목을 수정하지 않고 서버 전체 문서에 대한 분류만 한 번에 보낸다', async () => {
  const before = JSON.stringify(docs)
  state.request
    .mockResolvedValueOnce({ revision: 'r1', documents: docs })
    .mockResolvedValueOnce({ changed: 2 })
  await startDocumentClassification()
  await vi.waitFor(() => expect(getDocumentClassificationState().status).toBe('completed'))
  expect(JSON.stringify(docs)).toBe(before)
  expect(state.request.mock.calls[1][0]).toMatchObject({
    method: 'POST',
    body: {
      baseRevision: 'r1',
      assignments: [
        { documentId: 'doc-a', domain: '소프트웨어 개발' },
        { documentId: 'doc-b', domain: '책과 문화' }
      ]
    }
  })
  expect(Object.keys(state.request.mock.calls[1][0].body).sort()).toEqual([
    'assignments',
    'baseRevision',
    'requestId'
  ])
})
it('응답 유실 뒤 같은 요청을 재전송하고 AI를 다시 실행하지 않는다', async () => {
  state.request
    .mockResolvedValueOnce({ revision: 'r1', documents: docs })
    .mockRejectedValueOnce(new Error('network'))
  await startDocumentClassification()
  await vi.waitFor(() => expect(getDocumentClassificationState().status).toBe('failed'))
  await vi.waitFor(() => expect(isDocumentClassificationBusy()).toBe(false))
  const first = state.request.mock.calls[1][0].body
  state.request.mockResolvedValueOnce({ changed: 2 })
  await startDocumentClassification()
  await vi.waitFor(() => expect(getDocumentClassificationState().status).toBe('completed'))
  expect(state.request.mock.calls[2][0].body).toEqual(first)
  expect(state.complete).toHaveBeenCalledTimes(1)
  expect(
    JSON.parse(await readFile(path.join(state.root, 'user/classification/pending.json'), 'utf8'))
  ).toBeNull()
})
it('계정 전환 중 결과는 서버에 보내지 않고 사용자별 상태를 분리한다', async () => {
  state.request.mockResolvedValueOnce({ revision: 'r1', documents: docs })
  state.complete.mockImplementationOnce(async () => {
    state.owner = 'other'
    return valid
  })
  await startDocumentClassification()
  await vi.waitFor(() => expect(isDocumentClassificationBusy()).toBe(false))
  expect(state.request).toHaveBeenCalledTimes(1)
  expect(getDocumentClassificationState()).toEqual({ status: 'idle' })
  state.owner = 'user'
  expect(getDocumentClassificationState().status).toBe('failed')
})
it('누락/중복 id와 제목 그대로인 도메인을 거부한다', () => {
  expect(() => readClassificationAssignments('{"assignments":[]}', docs)).toThrow()
  expect(() =>
    readClassificationAssignments(
      '{"assignments":[{"id":"D0","domain":"개발"},{"id":"D0","domain":"개발"}]}',
      docs
    )
  ).toThrow()
  expect(() =>
    readClassificationAssignments(
      '{"assignments":[{"id":"D0","domain":"E2E 테스트 전략"},{"id":"D1","domain":"독서"}]}',
      docs
    )
  ).toThrow()
})
it('녹음 중 재분류를 시작하지 않는다', async () => {
  state.busy = true
  await expect(startDocumentClassification()).rejects.toThrow('녹음')
  expect(state.request).not.toHaveBeenCalled()
})
