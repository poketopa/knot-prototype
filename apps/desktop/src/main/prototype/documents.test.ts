import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ root: '', owner: 'owner-a', request: vi.fn() }))
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
import { closeDb, getDb } from '../db/connection'
import { getPrototypeDocument, listPrototypeDocuments } from './documents'
const document = {
  id: 'document-a',
  title: '로그인',
  latestVersion: 1,
  updatedAt: '2026-09-28T00:00:00Z',
  snapshotId: 'snapshot-1',
  body: {
    sections: [
      {
        recordingId: 'recording-a',
        recordingStartedAt: '2026-09-27T00:00:00Z',
        overview: '로그인 방법',
        decisions: [{ text: 'GitHub 로그인 사용', sourceUtteranceIds: ['u1'] }],
        unresolved: []
      }
    ]
  }
}
beforeEach(async () => {
  state.root = await mkdtemp(path.join(os.tmpdir(), 'knot-document-cache-'))
  state.owner = 'owner-a'
  state.request.mockReset()
})
afterEach(async () => {
  closeDb()
  await rm(state.root, { recursive: true, force: true })
})
it('서버의 구조화 문서를 Markdown과 날짜별 기여분으로 캐시한다', async () => {
  state.request.mockResolvedValueOnce(document)
  const result = await getPrototypeDocument({ documentId: document.id })
  expect(result?.body).toContain('# 로그인')
  expect(result?.body).toContain('GitHub 로그인 사용')
  expect(result?.contributions[0].startedAt).toBe('2026-09-27T00:00:00Z')
  const row = getDb().prepare('SELECT body FROM prototype_documents').get() as { body: string }
  expect(typeof row.body).toBe('string')
})
it('목록의 새 버전 번호를 이전 캐시 본문에 붙이지 않는다', async () => {
  state.request.mockResolvedValueOnce(document)
  await getPrototypeDocument({ documentId: document.id })
  state.request.mockResolvedValueOnce({
    documents: [{ ...document, latestVersion: 2, title: '새 제목' }]
  })
  expect((await listPrototypeDocuments())[0].latestVersion).toBe(2)
  state.request.mockRejectedValueOnce(new Error('offline'))
  expect(await getPrototypeDocument({ documentId: document.id })).toMatchObject({
    version: 1,
    title: '로그인',
    offline: true
  })
})
it('목록만 받은 문서는 빈 본문을 저장 완료된 문서로 보여주지 않는다', async () => {
  state.request.mockResolvedValueOnce({ documents: [document] })
  await listPrototypeDocuments()
  state.request.mockRejectedValueOnce(new Error('offline'))
  await expect(getPrototypeDocument({ documentId: document.id })).rejects.toThrow('아직 이 Mac에')
})

it('목록 overview가 없으면 상세 문서의 최신 기여분에서 overview를 보충한다', async () => {
  const newerDocument = {
    ...document,
    body: {
      sections: [
        {
          recordingId: 'recording-old',
          recordingStartedAt: '2026-09-26T00:00:00Z',
          overview: '이전 결정',
          decisions: [],
          unresolved: []
        },
        {
          recordingId: 'recording-new',
          recordingStartedAt: '2026-09-28T00:00:00Z',
          overview: '최신 결정',
          decisions: [],
          unresolved: []
        }
      ]
    }
  }
  state.request
    .mockResolvedValueOnce({
      documents: [
        { id: document.id, title: document.title, latestVersion: 1, updatedAt: document.updatedAt }
      ]
    })
    .mockResolvedValueOnce(newerDocument)

  const result = await listPrototypeDocuments()

  expect(result[0].overview).toBe('최신 결정')
  expect(state.request).toHaveBeenNthCalledWith(2, { path: `/documents/${document.id}` })
})

it('목록의 버전이 바뀌면 이전 캐시 overview를 재사용하지 않고 상세 문서에서 다시 가져온다', async () => {
  state.request.mockResolvedValueOnce(document)
  await getPrototypeDocument({ documentId: document.id })

  const updatedDocument = {
    ...document,
    latestVersion: 2,
    updatedAt: '2026-09-29T00:00:00Z',
    body: {
      sections: [
        {
          recordingId: 'recording-new',
          recordingStartedAt: '2026-09-29T00:00:00Z',
          overview: '새 버전 결정',
          decisions: [],
          unresolved: []
        }
      ]
    }
  }
  state.request
    .mockResolvedValueOnce({
      documents: [
        {
          id: document.id,
          title: document.title,
          latestVersion: 2,
          updatedAt: updatedDocument.updatedAt
        }
      ]
    })
    .mockResolvedValueOnce(updatedDocument)

  const result = await listPrototypeDocuments()

  expect(result[0]).toMatchObject({ latestVersion: 2, overview: '새 버전 결정' })
})

it('목록 overview가 이미 있으면 상세 문서를 추가로 요청하지 않는다', async () => {
  state.request.mockResolvedValueOnce({
    documents: [
      {
        id: document.id,
        title: document.title,
        latestVersion: 1,
        updatedAt: document.updatedAt,
        overview: '목록 overview'
      }
    ]
  })

  const result = await listPrototypeDocuments()

  expect(result[0].overview).toBe('목록 overview')
  expect(state.request).toHaveBeenCalledTimes(1)
})

it('요청 중 계정이 바뀌면 응답을 다른 계정에 캐시하지 않는다', async () => {
  state.request.mockImplementationOnce(async () => {
    closeDb()
    state.owner = 'owner-b'
    return document
  })
  await expect(getPrototypeDocument({ documentId: document.id })).rejects.toThrow('계정이 변경')
  expect(getDb().prepare('SELECT count(*) AS n FROM prototype_documents').get()).toEqual({ n: 0 })
})
