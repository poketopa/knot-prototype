import type { MeetingSearchResult } from '@shared/ipc'
import type { Meeting, MeetingStatus } from '@shared/types'
import { SEARCH_RESULT_LIMIT, toLikePattern } from '../searchQuery'
import { getDb } from './connection'
import { requirePrototypeUser } from '../prototype/authState'

interface MeetingRow {
  id: string
  title: string
  created_at: number
  duration_sec: number
  status: MeetingStatus
  error_message: string | null
  audio_path: string | null
  summary: string | null
  speaker_count: number | null
  owner_id: string | null
}

const toMeeting = (row: MeetingRow): Meeting => ({
  id: row.id,
  title: row.title,
  createdAt: row.created_at,
  durationSec: row.duration_sec,
  status: row.status,
  ...(row.error_message ? { errorMessage: row.error_message } : {}),
  ...(row.summary ? { summary: row.summary } : {}),
  ...(row.speaker_count ? { speakerCount: row.speaker_count } : {})
})

const ownerId = () => requirePrototypeUser().id

interface InsertMeetingParams {
  id: string
  title: string
  createdAt: number
  audioPath: string
}

export const insertMeeting = ({ id, title, createdAt, audioPath }: InsertMeetingParams) => {
  getDb()
    .prepare(
      `INSERT INTO meetings (id, owner_id, title, created_at, duration_sec, status, audio_path)
       VALUES (@id, @ownerId, @title, @createdAt, 0, 'recording', @audioPath)`
    )
    .run({ id, ownerId: ownerId(), title, createdAt, audioPath })
}

export const listMeetings = () =>
  getDb()
    .prepare('SELECT * FROM meetings WHERE owner_id = @ownerId ORDER BY created_at DESC')
    .all({ ownerId: ownerId() })
    .map((row) => toMeeting(row as MeetingRow))

interface SearchRow extends MeetingRow {
  match_utterance_id: string | null
  match_text: string | null
  match_start_sec: number | null
}

const toSearchResult = (row: SearchRow): MeetingSearchResult => ({
  meeting: toMeeting(row),
  match:
    row.match_utterance_id && row.match_text !== null && row.match_start_sec !== null
      ? { utteranceId: row.match_utterance_id, text: row.match_text, startSec: row.match_start_sec }
      : null
})

/**
 * 회의 제목과 발화 텍스트를 LIKE로 전체 스캔한다. 발화로 걸리면 순서가 가장 앞선 발화 하나를 함께 준다.
 * FTS5를 쓰지 않는 이유는 references/architecture.md "회의록 검색".
 */
export const searchMeetings = ({ query }: { query: string }) => {
  const pattern = toLikePattern(query)
  if (!pattern) return []

  return getDb()
    .prepare(
      `WITH first_match AS (
         SELECT u.meeting_id, u.id, u.text, u.start_sec,
                ROW_NUMBER() OVER (PARTITION BY u.meeting_id ORDER BY u.ord) AS rank
         FROM utterances u
         WHERE u.text LIKE @pattern ESCAPE '\\'
       )
       SELECT m.*, f.id AS match_utterance_id, f.text AS match_text, f.start_sec AS match_start_sec
       FROM meetings m
       LEFT JOIN first_match f ON f.meeting_id = m.id AND f.rank = 1
       WHERE m.owner_id = @ownerId AND (f.id IS NOT NULL OR m.title LIKE @pattern ESCAPE '\\')
       ORDER BY m.created_at DESC
       LIMIT @limit`
    )
    .all({ ownerId: ownerId(), pattern, limit: SEARCH_RESULT_LIMIT })
    .map((row) => toSearchResult(row as SearchRow))
}

export const findMeeting = ({ meetingId }: { meetingId: string }) => {
  const row = getDb()
    .prepare('SELECT * FROM meetings WHERE id = @meetingId AND owner_id = @ownerId')
    .get({ meetingId, ownerId: ownerId() })

  return row ? toMeeting(row as MeetingRow) : null
}

export const findAudioPath = ({ meetingId }: { meetingId: string }) => {
  const row = getDb()
    .prepare('SELECT audio_path FROM meetings WHERE id = @meetingId AND owner_id = @ownerId')
    .get({ meetingId, ownerId: ownerId() }) as Pick<MeetingRow, 'audio_path'> | undefined

  return row?.audio_path ?? null
}

interface UpdateMeetingStatusParams {
  meetingId: string
  status: MeetingStatus
  errorMessage?: string
}

export const updateMeetingStatus = ({
  meetingId,
  status,
  errorMessage
}: UpdateMeetingStatusParams) => {
  getDb()
    .prepare(
      `UPDATE meetings SET status = @status, error_message = @errorMessage
       WHERE id = @meetingId AND owner_id = @ownerId`
    )
    .run({ meetingId, ownerId: ownerId(), status, errorMessage: errorMessage ?? null })
}

export const updateMeetingDuration = ({
  meetingId,
  durationSec
}: {
  meetingId: string
  durationSec: number
}) => {
  getDb()
    .prepare(
      'UPDATE meetings SET duration_sec = @durationSec WHERE id = @meetingId AND owner_id = @ownerId'
    )
    .run({ meetingId, ownerId: ownerId(), durationSec })
}

/** 녹음 정지 시 입력한 참석자 수. 파이프라인이 화자 분리 전에 읽는다 */
export const updateMeetingSpeakerCount = ({
  meetingId,
  speakerCount
}: {
  meetingId: string
  speakerCount: number
}) => {
  getDb()
    .prepare(
      `UPDATE meetings SET speaker_count = @speakerCount
       WHERE id = @meetingId AND owner_id = @ownerId`
    )
    .run({ meetingId, ownerId: ownerId(), speakerCount })
}

/** 제목을 바꾼다. 대상 회의가 없으면 0을 돌려준다 */
export const renameMeeting = ({ meetingId, title }: { meetingId: string; title: string }) =>
  getDb()
    .prepare('UPDATE meetings SET title = @title WHERE id = @meetingId AND owner_id = @ownerId')
    .run({
      meetingId,
      ownerId: ownerId(),
      title
    }).changes

/** 원본 WAV를 지운 뒤 경로를 비운다. 파일이 없는 회의는 재처리할 수 없다 */
export const clearAudioPath = ({ meetingId }: { meetingId: string }) => {
  getDb()
    .prepare('UPDATE meetings SET audio_path = NULL WHERE id = @meetingId AND owner_id = @ownerId')
    .run({ meetingId, ownerId: ownerId() })
}

/** 발화·화자는 ON DELETE CASCADE로 함께 지워진다 (references/data-model.md) */
export const deleteMeeting = ({ meetingId }: { meetingId: string }) =>
  getDb()
    .prepare('DELETE FROM meetings WHERE id = @meetingId AND owner_id = @ownerId')
    .run({ meetingId, ownerId: ownerId() }).changes

/** 로컬 LLM 요약 결과를 저장한다 (Phase 5). 다시 만들면 덮어쓴다 */
export const updateMeetingSummary = ({
  meetingId,
  summary
}: {
  meetingId: string
  summary: string
}) =>
  getDb()
    .prepare('UPDATE meetings SET summary = @summary WHERE id = @meetingId AND owner_id = @ownerId')
    .run({ meetingId, ownerId: ownerId(), summary }).changes > 0

/** 이전 실행이 녹음·처리 중에 죽은 경우 남는 행. 시작 시 한 번 정리한다 */
export const failStaleMeetings = () =>
  getDb()
    .prepare(
      `UPDATE meetings
       SET status = 'error', error_message = '앱이 종료되어 처리가 중단되었습니다'
       WHERE owner_id = @ownerId
         AND status IN ('recording', 'processing')
         AND NOT EXISTS (
           SELECT 1
           FROM prototype_jobs j
           WHERE j.owner_id = meetings.owner_id
             AND j.recording_id = meetings.id
             AND j.status IN ('pending', 'running')
         )`
    )
    .run({ ownerId: ownerId() }).changes
