import { randomUUID } from 'node:crypto'
import type { MergedUtterance, Utterance } from '@shared/types'
import { getDb } from './connection'
import { requirePrototypeUser } from '../prototype/authState'

interface UtteranceRow {
  id: string
  meeting_id: string
  ord: number
  speaker_label: string
  start_sec: number
  end_sec: number
  text: string
}

const toUtterance = (row: UtteranceRow): Utterance => ({
  id: row.id,
  meetingId: row.meeting_id,
  ord: row.ord,
  speakerLabel: row.speaker_label,
  startSec: row.start_sec,
  endSec: row.end_sec,
  text: row.text
})

export const listUtterances = ({ meetingId }: { meetingId: string }) =>
  getDb()
    .prepare(
      `SELECT u.*
       FROM utterances u
       JOIN meetings m ON m.id = u.meeting_id
       WHERE u.meeting_id = @meetingId AND m.owner_id = @ownerId
       ORDER BY u.ord`
    )
    .all({ meetingId, ownerId: requirePrototypeUser().id })
    .map((row) => toUtterance(row as UtteranceRow))

interface UpdateUtteranceTextParams {
  meetingId: string
  utteranceId: string
  text: string
}

/** meeting_id를 함께 걸어 다른 회의의 발화를 고치지 못하게 한다 */
export const updateUtteranceText = ({ meetingId, utteranceId, text }: UpdateUtteranceTextParams) =>
  getDb()
    .prepare(
      `UPDATE utterances
       SET text = @text
       WHERE id = @utteranceId
         AND meeting_id = @meetingId
         AND EXISTS (
           SELECT 1 FROM meetings m
           WHERE m.id = @meetingId AND m.owner_id = @ownerId
         )`
    )
    .run({ meetingId, utteranceId, text, ownerId: requirePrototypeUser().id }).changes

interface UpdateUtteranceSpeakerParams {
  meetingId: string
  utteranceId: string
  speakerLabel: string
}

export const updateUtteranceSpeaker = ({
  meetingId,
  utteranceId,
  speakerLabel
}: UpdateUtteranceSpeakerParams) =>
  getDb()
    .prepare(
      `UPDATE utterances SET speaker_label = @speakerLabel
       WHERE id = @utteranceId
         AND meeting_id = @meetingId
         AND EXISTS (
           SELECT 1 FROM meetings m
           WHERE m.id = @meetingId AND m.owner_id = @ownerId
         )`
    )
    .run({ meetingId, utteranceId, speakerLabel, ownerId: requirePrototypeUser().id }).changes

interface ReplaceUtterancesParams {
  meetingId: string
  utterances: MergedUtterance[]
}

/** 파이프라인 결과 저장. 재처리해도 중복이 남지 않도록 기존 발화를 지우고 다시 넣는다 */
export const replaceUtterances = ({ meetingId, utterances }: ReplaceUtterancesParams) => {
  const db = getDb()
  const remove = db.prepare('DELETE FROM utterances WHERE meeting_id = ?')
  const insert = db.prepare(
    `INSERT INTO utterances (id, meeting_id, ord, speaker_label, start_sec, end_sec, text)
     VALUES (@id, @meetingId, @ord, @speakerLabel, @startSec, @endSec, @text)`
  )

  db.transaction(() => {
    const ownerId = requirePrototypeUser().id
    const exists = db
      .prepare('SELECT 1 FROM meetings WHERE id = @meetingId AND owner_id = @ownerId')
      .get({ meetingId, ownerId })
    if (!exists) throw new Error('회의를 찾을 수 없습니다')
    remove.run(meetingId)
    utterances.forEach((utterance) => insert.run({ ...utterance, id: randomUUID(), meetingId }))
  })()
}
