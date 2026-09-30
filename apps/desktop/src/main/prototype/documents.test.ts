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
import { getPrototypeDocument, legacyDocumentId, listPrototypeDocuments } from './documents'
const document = {
  id: 'document-a',
  title: '로그인 경험',
  domain: '회원',
  recordingId: 'recording-a',
  recordingStartedAt: '2026-09-27T00:00:00Z',
  durationSec: 305,
  latestVersion: 1,
  updatedAt: '2026-09-28T00:00:00Z',
  overview: 'GitHub 로그인 경험을 공유했습니다.',
  body: {
    schemaVersion: 2,
    summarySections: [
      {
        heading: '사용해 본 경험',
        text: 'GitHub 로그인 경험을 공유했습니다.',
        sourceUtteranceIds: ['u1']
      }
    ],
    outline: [
      {
        heading: '어려웠던 점',
        items: [{ text: '버튼의 위치를 찾기 어려웠습니다.', sourceUtteranceIds: ['u1'] }]
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
it('자유로운 핵심과 개괄식 상세를 캐시하고 단일 원문만 연결한다', async () => {
  state.request.mockResolvedValueOnce(document)
  const result = await getPrototypeDocument({ documentId: document.id })
  expect(result?.body).toContain('## 사용해 본 경험')
  expect(result?.body).toContain('- 버튼의 위치를 찾기 어려웠습니다.')
  expect(result?.body).not.toContain('## 논의 상세')
  expect(result?.body).not.toMatch(/확정된 결정|미결정 사항/)
  expect(result?.durationSec).toBe(305)
  expect(result?.contributions).toHaveLength(1)
  expect(result?.contributions[0].recordingId).toBe('recording-a')
  state.request.mockRejectedValueOnce(new Error('offline'))
  expect(await getPrototypeDocument({ documentId: document.id })).toMatchObject({
    domain: '회원',
    version: 1,
    summarySections: document.body.summarySections,
    offline: true
  })
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
    title: '로그인 경험'
  })
})

it('목록만 받은 문서는 저장 완료된 빈 문서로 보여주지 않는다', async () => {
  state.request.mockResolvedValueOnce({ documents: [document] })
  await listPrototypeDocuments()
  state.request.mockRejectedValueOnce(new Error('offline'))
  await expect(getPrototypeDocument({ documentId: document.id })).rejects.toThrow('아직 이 Mac에')
})

it('누적 캐시를 회의마다 분리하되 원본 캐시는 그대로 보존한다', async () => {
  const contributions = ['recording-a', 'recording-b'].map((recordingId) => ({
    recordingId,
    startedAt: document.recordingStartedAt,
    section: {
      overview: '로그인 방법',
      decisions: [{ text: recordingId, sourceUtteranceIds: ['u1'] }],
      unresolved: []
    }
  }))
  const original = JSON.stringify(contributions)
  getDb()
    .prepare(
      `INSERT INTO prototype_documents
    (id,owner_id,title,latest_version,body,contributions,overview,updated_at)
    VALUES ('old-doc','owner-a','회원',2,'old-body',?,'로그인',?)`
    )
    .run(original, document.updatedAt)
  state.request.mockRejectedValue(new Error('offline'))
  const first = await listPrototypeDocuments()
  const second = await listPrototypeDocuments()
  expect(first).toHaveLength(2)
  expect(second).toEqual(first)
  expect(new Set(first.map((item) => item.recordingId)).size).toBe(2)
  expect(new Set(first.map((item) => item.id)).size).toBe(2)
  expect(first[0].id).toMatch(/^[0-9a-f-]{36}$/)
  const detail = await getPrototypeDocument({
    documentId: legacyDocumentId('old-doc', 'recording-b')
  })
  expect(detail?.contributions).toHaveLength(1)
  expect(detail?.body).toContain('recording-b')
  expect(detail?.body).not.toContain('recording-a')
  expect(
    getDb().prepare('SELECT body,contributions,latest_version FROM prototype_documents').get()
  ).toEqual({ body: 'old-body', contributions: original, latest_version: 2 })
})

it('AI 완료된 로컬 문서를 서버 실패 중에도 즉시 읽고 재시작 뒤에도 유지한다', async () => {
  const db = getDb()
  db.prepare(
    `INSERT INTO meetings (id,owner_id,title,created_at,duration_sec,status) VALUES ('local-recording','owner-a','회의',1,60,'done')`
  ).run()
  db.prepare(
    `INSERT INTO prototype_artifacts
    (id,owner_id,recording_id,kind,content_json,sha256,byte_length,sync_status,created_at)
    VALUES ('local-analysis','owner-a','local-recording','ai_analysis',?,'hash',1,'pending',2)`
  ).run(
    JSON.stringify({
      schemaVersion: 2,
      topics: [
        {
          documentId: 'local-topic',
          domain: document.domain,
          title: document.title,
          summarySections: document.body.summarySections,
          outline: document.body.outline
        }
      ]
    })
  )
  state.request.mockRejectedValue(new Error('server failed'))
  expect(await listPrototypeDocuments()).toMatchObject([
    { id: 'local-topic', recordingId: 'local-recording' }
  ])
  closeDb()
  const detail = await getPrototypeDocument({ documentId: 'local-topic' })
  expect(detail?.durationSec).toBe(60)
  expect(detail?.summarySections).toEqual(document.body.summarySections)
  expect(detail?.outline).toEqual(document.body.outline)
  expect(detail?.offline).toBe(true)
})

it('최신 V2 분석이 있는 녹음은 이전 문서 캐시와 원격 예전 문서를 현재 목록에서 숨긴다', async () => {
  const db = getDb()
  db.prepare(
    `INSERT INTO meetings (id,owner_id,title,created_at,duration_sec,status)
     VALUES ('recording-a','owner-a','회의',1,60,'done')`
  ).run()
  db.prepare(
    `INSERT INTO prototype_artifacts
    (id,owner_id,recording_id,kind,content_json,sha256,byte_length,prompt_version,sync_status,created_at)
    VALUES
    ('old-analysis','owner-a','recording-a','ai_analysis',?,'old-hash',1,'topic-analysis-v2','succeeded',1),
    ('new-analysis','owner-a','recording-a','ai_analysis',?,'new-hash',1,'topic-analysis-v3:document-reanalysis-20260930','pending',2)`
  ).run(
    JSON.stringify({
      schemaVersion: 2,
      topics: [
        {
          documentId: 'old-topic',
          domain: '문서',
          title: '예전 문서',
          summarySections: document.body.summarySections,
          outline: document.body.outline
        }
      ]
    }),
    JSON.stringify({
      schemaVersion: 2,
      topics: [
        {
          documentId: 'new-topic',
          domain: 'AI',
          title: '새 문서',
          summarySections: document.body.summarySections,
          outline: document.body.outline
        }
      ]
    })
  )
  db.prepare(
    `INSERT INTO prototype_document_tree
    (id,owner_id,title,domain,recording_id,recording_started_at,latest_version,overview,detail_json,updated_at)
    VALUES ('old-topic','owner-a','예전 문서','문서','recording-a','2026-09-30T00:00:00.000Z',1,'예전','{}','2026-09-30T00:00:00.000Z')`
  ).run()
  state.request.mockResolvedValueOnce({
    documents: [
      {
        ...document,
        id: 'old-topic',
        title: '서버 예전 문서',
        recordingId: 'recording-a'
      }
    ]
  })

  expect(await listPrototypeDocuments()).toMatchObject([
    { id: 'new-topic', title: '새 문서', recordingId: 'recording-a' }
  ])
  state.request.mockRejectedValueOnce(new Error('offline'))
  await expect(getPrototypeDocument({ documentId: 'old-topic' })).resolves.toBeNull()
})

it('빈 분석은 빈 문서를 만들지 않는다', async () => {
  const db = getDb()
  db.prepare(
    `INSERT INTO meetings (id,owner_id,title,created_at,duration_sec,status) VALUES ('empty','owner-a','회의',1,60,'done')`
  ).run()
  db.prepare(
    `INSERT INTO prototype_artifacts
    (id,owner_id,recording_id,kind,content_json,sha256,byte_length,sync_status,created_at)
    VALUES ('empty-analysis','owner-a','empty','ai_analysis','{"schemaVersion":2,"topics":[]}','hash',1,'pending',2)`
  ).run()
  state.request.mockRejectedValue(new Error('offline'))
  expect(await listPrototypeDocuments()).toEqual([])
})

it('요청 중 계정이 바뀌면 다른 계정에 캐시하지 않는다', async () => {
  state.request.mockImplementationOnce(async () => {
    closeDb()
    state.owner = 'owner-b'
    return document
  })
  await expect(getPrototypeDocument({ documentId: document.id })).rejects.toThrow('계정이 변경')
  expect(getDb().prepare('SELECT count(*) AS n FROM prototype_document_tree').get()).toEqual({
    n: 0
  })
})

it('목록은 도메인과 원문 연결을 한 번의 요청으로 받는다', async () => {
  state.request.mockResolvedValueOnce({ documents: [document] })
  expect(await listPrototypeDocuments()).toMatchObject([
    { domain: '회원', recordingId: 'recording-a' }
  ])
  expect(state.request).toHaveBeenCalledExactlyOnceWith({ path: '/document-tree' })
})

it('원격 목록의 사용자별 도메인을 고정 키워드로 덮어쓰지 않는다', async () => {
  state.request.mockResolvedValueOnce({
    documents: [
      {
        ...document,
        id: 'document-ai',
        title: '녹음 분석 품질과 AI 성능 개선',
        domain: '인공지능 연구'
      },
      {
        ...document,
        id: 'document-dev',
        title: '서버 배포와 업로드 QA',
        domain: '제품 개발'
      }
    ]
  })

  expect(await listPrototypeDocuments()).toMatchObject([
    { id: 'document-ai', domain: '인공지능 연구' },
    { id: 'document-dev', domain: '제품 개발' }
  ])
})
