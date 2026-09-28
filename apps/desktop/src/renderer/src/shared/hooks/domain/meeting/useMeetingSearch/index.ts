import { useCallback, useEffect, useState } from 'react'
import type { MeetingSearchResult } from '@shared/ipc'
import { onMeetingsChanged } from '@renderer/shared/api/events'
import { searchMeetingsApi } from '@renderer/shared/api/meetings'

/** 한 글자 칠 때마다 전체 스캔하지 않도록 입력이 멈춘 뒤에 찾는다 (references/architecture.md "회의록 검색") */
const SEARCH_DEBOUNCE_MS = 200

interface UseMeetingSearchParams {
  query: string
}

/**
 * 회의 제목·발화 검색. 질의가 공백뿐이면 검색하지 않는다(`isActive` 거짓).
 * 검색 중에도 목록이 바뀌면(제목 변경·삭제·처리 완료) 같은 질의로 다시 찾는다.
 */
const useMeetingSearch = ({ query }: UseMeetingSearchParams) => {
  const trimmed = query.trim()
  const [results, setResults] = useState<MeetingSearchResult[]>([])
  const [searchedQuery, setSearchedQuery] = useState('')
  const [error, setError] = useState<Error | null>(null)

  const search = useCallback(
    (target: string) =>
      searchMeetingsApi({ query: target })
        .then((next) => {
          setResults(next)
          setSearchedQuery(target)
          setError(null)
        })
        .catch((caught: unknown) =>
          setError(caught instanceof Error ? caught : new Error('회의록을 검색하지 못했습니다'))
        ),
    []
  )

  useEffect(() => {
    if (!trimmed) return

    const timer = setTimeout(() => void search(trimmed), SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [trimmed, search])

  useEffect(() => {
    if (!trimmed) return

    return onMeetingsChanged(() => void search(trimmed))
  }, [trimmed, search])

  const isActive = trimmed !== ''

  return {
    isActive,
    // 디바운스 중에는 이전 질의의 결과를 보여 주지 않는다 — 방금 지운 글자의 결과가 남아 보인다
    isSearching: isActive && searchedQuery !== trimmed && !error,
    results: isActive && searchedQuery === trimmed ? results : [],
    error: isActive ? error : null
  }
}

export default useMeetingSearch
