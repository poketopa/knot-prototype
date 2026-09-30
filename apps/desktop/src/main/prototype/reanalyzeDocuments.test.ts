import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TopicAnalysisAttempt } from '@shared/types'

const state = vi.hoisted(() => ({
  root: '',
  owner: 'owner-a',
  recordingMeetingId: null as string | null,
  runTopicAnalysis: vi.fn()
}))

vi.mock('electron', () => ({
  __esModule: true,
  app: {
    getPath: () => state.root
  },
  BrowserWindow: {
    getAllWindows: () => []
  }
}))

vi.mock('./authState', () => ({
  requirePrototypeUser: () => ({ id: state.owner, displayName: 'Owner' }),
  prototypeUserRoot: () => path.join(state.root, state.owner)
}))

vi.mock('../audio/session', () => ({
  getRecordingState: () => ({
    meetingId: state.recordingMeetingId,
    startedAt: null,
    level: 0
  })
}))

vi.mock('../summary/run', () => ({
  runTopicAnalysis: state.runTopicAnalysis
}))
vi.mock('../pipeline/run', () => ({ runPipeline: vi.fn() }))
vi.mock('../summary/meetingSummary', () => ({ createMeetingSummary: vi.fn() }))
vi.mock('../glossary/draft', () => ({ runGlossaryDraft: vi.fn() }))

const attempt = (documentId: string): TopicAnalysisAttempt => ({
  id: 'attempt-1',
  provider: 'local',
  model: 'test-model',
  promptVersion: 'topic-analysis-v2',
  rawResponses: [{ label: 'topic-whole', text: '{"schemaVersion":2}' }],
  partialResults: [],
  result: {
    schemaVersion: 2,
    topics: [
      {
        documentId,
        domain: '녹음 분석 품질과 AI 성능 개선',
        title: '화자 분리 모델 개선',
        summarySections: [
          {
            heading: '핵심 요약',
            text: '화자 분리 품질을 먼저 개선하기로 논의했다.',
            sourceUtteranceIds: ['artifact-utt-1']
          }
        ],
        outline: [
          {
            heading: '이유',
            items: [
              {
                text: '현재 전사 품질보다 화자 구분 실패가 더 큰 문제로 확인됐다.',
                sourceUtteranceIds: ['artifact-utt-1']
              }
            ]
          }
        ]
      }
    ]
  }
})

const transcriptContent = ({
  meetingId = 'meeting-a',
  text = '화자 분리 품질을 논의했다.'
}: {
  meetingId?: string
  text?: string
} = {}) =>
  JSON.stringify({
    schemaVersion: 1,
    utterances: [
      {
        id: 'artifact-utt-1',
        meetingId,
        ord: 0,
        speakerLabel: '화자 1',
        startSec: 0,
        endSec: 1,
        text
      }
    ]
  })

const insertDoneMeeting = (db: ReturnType<typeof import('../db/connection').getDb>) => {
  db.prepare(
    `INSERT INTO meetings (id,owner_id,title,created_at,duration_sec,status,audio_path)
     VALUES ('meeting-a','owner-a','회의 A',1,60,'done','/tmp/a.wav')`
  ).run()
}

const insertTranscriptArtifact = (
  db: ReturnType<typeof import('../db/connection').getDb>,
  text = '화자 분리 품질을 논의했다.'
) => {
  db.prepare(
    `INSERT INTO prototype_artifacts
     (id,owner_id,recording_id,kind,content_json,sha256,byte_length,prompt_version,sync_status,created_at)
     VALUES ('transcript-a','owner-a','meeting-a','transcript',?,'transcript-hash',2,NULL,'succeeded',1)`
  ).run(transcriptContent({ text }))
}

describe('reanalyzePrototypeDocuments', () => {
  beforeEach(async () => {
    vi.resetModules()
    state.root = await mkdtemp(path.join(os.tmpdir(), 'knot-reanalyze-docs-'))
    state.owner = 'owner-a'
    state.recordingMeetingId = null
    state.runTopicAnalysis.mockReset()
  })

  afterEach(async () => {
    const { closeDb } = await import('../db/connection')
    closeDb()
    await rm(state.root, { recursive: true, force: true })
  })

  it('현재 owner의 최신 전사 artifact를 새 분석으로 재발행하고 기존 산출물은 보존한다', async () => {
    const { getDb } = await import('../db/connection')
    const { reanalyzePrototypeDocuments, DOCUMENT_REANALYSIS_PROMPT_VERSION } =
      await import('./reanalyzeDocuments')
    const db = getDb()
    insertDoneMeeting(db)
    db.prepare(
      `INSERT INTO utterances (id,meeting_id,ord,speaker_label,start_sec,end_sec,text)
       VALUES ('utt-1','meeting-a',0,'화자 1',0,1,'DB 전사는 AI에 쓰면 안 된다.')`
    ).run()
    insertTranscriptArtifact(db, 'artifact 전사만 AI에 써야 한다.')
    db.prepare(
      `INSERT INTO prototype_artifacts
       (id,owner_id,recording_id,kind,content_json,sha256,byte_length,prompt_version,sync_status,created_at)
       VALUES ('old-analysis','owner-a','meeting-a','ai_analysis','{"schemaVersion":2,"topics":[]}','old-hash',2,'topic-analysis-v2','succeeded',2)`
    ).run()
    db.prepare(
      `INSERT INTO prototype_document_tree
       (id,owner_id,title,domain,recording_id,recording_started_at,latest_version,overview,detail_json,updated_at)
       VALUES ('old-doc','owner-a','예전 문서','예전','meeting-a','2026-09-30T00:00:00.000Z',1,'예전','{}','2026-09-30T00:00:00.000Z')`
    ).run()
    state.runTopicAnalysis.mockResolvedValue(attempt('22222222-2222-4222-8222-222222222222'))

    expect(await reanalyzePrototypeDocuments()).toMatchObject({
      requested: 1,
      processed: 1,
      skipped: 0,
      failed: 0
    })

    expect(state.runTopicAnalysis).toHaveBeenCalledOnce()
    expect(state.runTopicAnalysis.mock.calls[0][0].utterances).toMatchObject([
      { id: 'artifact-utt-1', text: 'artifact 전사만 AI에 써야 한다.' }
    ])
    const artifacts = db
      .prepare(
        `SELECT id,kind,prompt_version FROM prototype_artifacts
         WHERE owner_id='owner-a' AND recording_id='meeting-a'
         ORDER BY created_at,id`
      )
      .all() as Array<{ id: string; kind: string; prompt_version: string | null }>
    expect(artifacts).toEqual(
      expect.arrayContaining([
        { id: 'old-analysis', kind: 'ai_analysis', prompt_version: 'topic-analysis-v2' },
        expect.objectContaining({
          kind: 'ai_analysis',
          prompt_version: DOCUMENT_REANALYSIS_PROMPT_VERSION
        })
      ])
    )
    expect(
      db
        .prepare(
          `SELECT id,title,domain,recording_id FROM prototype_document_tree
           WHERE owner_id='owner-a' ORDER BY id`
        )
        .all()
    ).toEqual([
      {
        id: '22222222-2222-4222-8222-222222222222',
        title: '화자 분리 모델 개선',
        domain: 'AI',
        recording_id: 'meeting-a'
      }
    ])
    const publishPayload = db
      .prepare("SELECT payload_json FROM prototype_outbox WHERE kind='publish'")
      .get() as { payload_json: string }
    expect(JSON.parse(publishPayload.payload_json)).toMatchObject({
      recordingId: 'meeting-a',
      transcriptArtifactId: 'transcript-a',
      replaceRecordingDocuments: true
    })

    state.runTopicAnalysis.mockClear()
    expect(await reanalyzePrototypeDocuments()).toMatchObject({ requested: 0, processed: 0 })
    expect(state.runTopicAnalysis).not.toHaveBeenCalled()
  })

  it('동시에 두 번 호출해도 같은 owner는 하나의 실행만 공유한다', async () => {
    const { getDb } = await import('../db/connection')
    const { reanalyzePrototypeDocuments } = await import('./reanalyzeDocuments')
    const db = getDb()
    insertDoneMeeting(db)
    insertTranscriptArtifact(db)
    let resolveRun: (value: TopicAnalysisAttempt) => void = () => {}
    state.runTopicAnalysis.mockReturnValue(
      new Promise((resolve) => {
        resolveRun = resolve
      })
    )

    const first = reanalyzePrototypeDocuments()
    const second = reanalyzePrototypeDocuments()
    resolveRun(attempt('22222222-2222-4222-8222-222222222222'))

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ processed: 1 }),
      expect.objectContaining({ processed: 1 })
    ])
    expect(state.runTopicAnalysis).toHaveBeenCalledOnce()
  })

  it('실행 중 다른 owner가 호출하면 이전 owner의 결과를 공유하지 않는다', async () => {
    const { getDb } = await import('../db/connection')
    const { reanalyzePrototypeDocuments } = await import('./reanalyzeDocuments')
    const db = getDb()
    insertDoneMeeting(db)
    insertTranscriptArtifact(db)
    let resolveRun: (value: TopicAnalysisAttempt) => void = () => {}
    state.runTopicAnalysis.mockReturnValue(
      new Promise((resolve) => {
        resolveRun = resolve
      })
    )

    const first = reanalyzePrototypeDocuments()
    state.owner = 'owner-b'
    await expect(reanalyzePrototypeDocuments()).rejects.toThrow('다른 계정의 문서 재정리')
    state.owner = 'owner-a'
    resolveRun(attempt('22222222-2222-4222-8222-222222222222'))
    await expect(first).resolves.toMatchObject({ processed: 1 })
  })

  it('실행 중 계정이 바뀌면 산출물을 쓰지 않고 중단한다', async () => {
    const { getDb } = await import('../db/connection')
    const { reanalyzePrototypeDocuments } = await import('./reanalyzeDocuments')
    const db = getDb()
    insertDoneMeeting(db)
    insertTranscriptArtifact(db)
    state.runTopicAnalysis.mockImplementation(async () => {
      state.owner = 'owner-b'
      return attempt('22222222-2222-4222-8222-222222222222')
    })

    await expect(reanalyzePrototypeDocuments()).rejects.toThrow('계정이 변경되었습니다')
    expect(
      db
        .prepare(
          "SELECT count(*) AS count FROM prototype_artifacts WHERE kind IN ('ai_analysis','ai_raw','ai_partial')"
        )
        .get()
    ).toEqual({ count: 0 })
    expect(
      db.prepare("SELECT count(*) AS count FROM prototype_outbox WHERE kind='publish'").get()
    ).toEqual({
      count: 0
    })
  })

  it('현재 녹음이 진행 중이면 기존 문서 재정리를 시작하지 않는다', async () => {
    const { getDb } = await import('../db/connection')
    const { reanalyzePrototypeDocuments } = await import('./reanalyzeDocuments')
    const db = getDb()
    insertDoneMeeting(db)
    insertTranscriptArtifact(db)
    state.recordingMeetingId = 'meeting-a'

    await expect(reanalyzePrototypeDocuments()).rejects.toThrow('녹음 중에는')
    expect(state.runTopicAnalysis).not.toHaveBeenCalled()
  })

  it('처리 작업이 진행 중인 회의는 재정리하지 않는다', async () => {
    const { getDb } = await import('../db/connection')
    const { reanalyzePrototypeDocuments } = await import('./reanalyzeDocuments')
    const db = getDb()
    insertDoneMeeting(db)
    insertTranscriptArtifact(db)
    db.prepare(
      `INSERT INTO prototype_jobs
       (id,owner_id,recording_id,kind,status,stage,created_at,updated_at)
       VALUES ('job-a','owner-a','meeting-a','ai','running','summarizing',1,1)`
    ).run()

    expect(await reanalyzePrototypeDocuments()).toMatchObject({ requested: 0, processed: 0 })
    expect(state.runTopicAnalysis).not.toHaveBeenCalled()
  })

  it('DB 발화 행이 없어도 최신 전사 artifact가 있으면 그 원문으로 재정리한다', async () => {
    const { getDb } = await import('../db/connection')
    const { reanalyzePrototypeDocuments } = await import('./reanalyzeDocuments')
    const db = getDb()
    insertDoneMeeting(db)
    insertTranscriptArtifact(db, 'artifact 전사만 존재한다.')
    state.runTopicAnalysis.mockResolvedValue(attempt('22222222-2222-4222-8222-222222222222'))

    expect(await reanalyzePrototypeDocuments()).toMatchObject({ requested: 1, processed: 1 })
    expect(state.runTopicAnalysis.mock.calls[0][0].utterances).toMatchObject([
      { id: 'artifact-utt-1', text: 'artifact 전사만 존재한다.' }
    ])
  })

  it('새 분석 artifact는 있지만 publish 체크포인트가 없으면 다시 시도한다', async () => {
    const { getDb } = await import('../db/connection')
    const { reanalyzePrototypeDocuments, DOCUMENT_REANALYSIS_PROMPT_VERSION } =
      await import('./reanalyzeDocuments')
    const db = getDb()
    insertDoneMeeting(db)
    insertTranscriptArtifact(db)
    db.prepare(
      `INSERT INTO prototype_artifacts
       (id,owner_id,recording_id,kind,content_json,sha256,byte_length,prompt_version,sync_status,created_at)
       VALUES ('checkpoint-lost','owner-a','meeting-a','ai_analysis','{"schemaVersion":2,"topics":[]}','lost-hash',2,?,'pending',2)`
    ).run(DOCUMENT_REANALYSIS_PROMPT_VERSION)
    state.runTopicAnalysis.mockResolvedValue(attempt('22222222-2222-4222-8222-222222222222'))

    expect(await reanalyzePrototypeDocuments()).toMatchObject({ requested: 1, processed: 1 })
    expect(state.runTopicAnalysis).toHaveBeenCalledOnce()
  })
})
