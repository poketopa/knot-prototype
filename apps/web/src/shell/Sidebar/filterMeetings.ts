/**
 * 사이드바 검색. 제목과 발화 텍스트를 부분 일치로 거른다 (데스크탑 `meetings:search`와 같은 대상).
 * 발화로 걸리면 순서가 가장 앞선 발화의 조각을 준다.
 */

import type { MeetingRecord } from '../../types/meeting'

/** 일치 앞뒤로 보여 주는 글자 수 */
const SNIPPET_CONTEXT_CHARS = 14

export interface SearchSnippet {
  before: string
  match: string
  after: string
}

export interface FilteredMeeting {
  meeting: MeetingRecord
  /** 제목으로만 걸렸으면 null */
  snippet: SearchSnippet | null
}

const snippetOf = ({ text, query }: { text: string; query: string }): SearchSnippet | null => {
  const index = text.toLowerCase().indexOf(query.toLowerCase())
  if (index < 0) return null

  const start = Math.max(0, index - SNIPPET_CONTEXT_CHARS)
  const end = Math.min(text.length, index + query.length + SNIPPET_CONTEXT_CHARS)

  return {
    before: `${start > 0 ? '…' : ''}${text.slice(start, index)}`,
    match: text.slice(index, index + query.length),
    after: `${text.slice(index + query.length, end)}${end < text.length ? '…' : ''}`
  }
}

interface FilterMeetingsParams {
  meetings: MeetingRecord[]
  query: string
}

export const filterMeetings = ({ meetings, query }: FilterMeetingsParams): FilteredMeeting[] => {
  const trimmed = query.trim()
  if (trimmed === '') return meetings.map((meeting) => ({ meeting, snippet: null }))

  return meetings.flatMap((meeting): FilteredMeeting[] => {
    if (meeting.title.toLowerCase().includes(trimmed.toLowerCase())) {
      return [{ meeting, snippet: null }]
    }

    for (const utterance of meeting.utterances) {
      const snippet = snippetOf({ text: utterance.text, query: trimmed })
      if (snippet) return [{ meeting, snippet }]
    }

    return []
  })
}
