import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listMeetings, listPrototypeProcessing, findPrototypeArtifact } = vi.hoisted(() => ({
  listMeetings: vi.fn(),
  listPrototypeProcessing: vi.fn(),
  findPrototypeArtifact: vi.fn()
}))
vi.mock('../db/meetings', () => ({ listMeetings, updateMeetingSummary: vi.fn() }))
vi.mock('./jobs', () => ({ listPrototypeProcessing }))
vi.mock('./artifacts', () => ({ findPrototypeArtifact, registerPrototypeArtifact: vi.fn() }))
vi.mock('../summary/meetingSummary', () => ({
  fallbackMeetingSummary: ({ topics }: { topics: Array<{ overview: string }> }) => ({
    schemaVersion: 1,
    headline: topics[0]?.overview ?? '',
    body: topics.map((topic) => topic.overview).join(' ')
  })
}))

const meeting = {
  id: 'meeting-1',
  title: '회의',
  createdAt: Date.UTC(2026, 8, 30),
  durationSec: 3600,
  status: 'done'
}
const analysis = {
  content_json: JSON.stringify({
    schemaVersion: 1,
    topics: [{ title: 'A', overview: 'A를 논의했습니다.' }]
  })
}

describe('meeting summary history', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listMeetings.mockReturnValue([meeting])
    findPrototypeArtifact.mockImplementation(({ kind }: { kind: string }) =>
      kind === 'ai_analysis' ? analysis : undefined
    )
  })

  it('기존 AI 분석은 모델을 다시 돌리지 않고 요약으로 보여준다', async () => {
    listPrototypeProcessing.mockReturnValue([
      { meetingId: meeting.id, status: 'succeeded', hasTranscript: true }
    ])
    const { listMeetingSummaries } = await import('./meetingSummaries')
    expect(listMeetingSummaries()[0]).toMatchObject({
      status: 'ready',
      headline: 'A를 논의했습니다.',
      hasTranscript: true
    })
  })

  it('새 요약이 실패하면 저장된 분석이 있어도 성공으로 오인하지 않는다', async () => {
    listPrototypeProcessing.mockReturnValue([
      { meetingId: meeting.id, status: 'failed', error: '요약 실패' }
    ])
    const { listMeetingSummaries } = await import('./meetingSummaries')
    expect(listMeetingSummaries()[0]).toMatchObject({ status: 'failed', error: '요약 실패' })
  })
})
