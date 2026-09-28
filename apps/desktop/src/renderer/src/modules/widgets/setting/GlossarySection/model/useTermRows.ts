import { useCallback, useRef, useState, type RefObject } from 'react'

import type { TermEntry, TermRow } from '../types/termRow'
import { EMPTY_TERM_ENTRY, parseTermLine, parseTermLines, toTermLines } from '../utils/termLines'

export interface UpdateRowParams {
  id: number
  patch: Partial<TermEntry>
}

export interface PasteRowsParams {
  id: number
  text: string
}

const isBlank = ({ term, readings }: TermEntry) => !term.trim() && !readings.trim()

interface WithIdsParams {
  entries: TermEntry[]
  nextIdRef: RefObject<number>
}

const withIds = ({ entries, nextIdRef }: WithIdsParams) =>
  entries.map((entry) => ({ ...entry, id: nextIdRef.current++ }))

/** 목록이 비면 빈 행 하나를 둬서 사용자가 바로 입력할 수 있게 한다 */
const rowsOf = ({ entries, nextIdRef }: WithIdsParams) =>
  withIds({ entries: entries.length ? entries : [EMPTY_TERM_ENTRY], nextIdRef })

/**
 * 용어 목록 편집 행. 저장 형식(줄 목록)과의 변환은 여기서만 한다
 * (references/architecture.md "용어 사전 > 화면").
 */
const useTermRows = () => {
  const nextIdRef = useRef(0)
  const [rows, setRows] = useState<TermRow[]>([])
  const [focusId, setFocusId] = useState<number | null>(null)

  const termLines = toTermLines(rows)

  // 불러오기 effect가 의존하므로 참조가 바뀌지 않게 둔다
  const resetRows = useCallback((lines: string[]) => {
    setFocusId(null)
    setRows(rowsOf({ entries: lines.map(parseTermLine), nextIdRef }))
  }, [])

  const addRow = (afterId?: number) => {
    const [row] = withIds({ entries: [EMPTY_TERM_ENTRY], nextIdRef })
    setFocusId(row.id)
    setRows((current) => {
      const index = current.findIndex(({ id }) => id === afterId)
      return index < 0 ? [...current, row] : current.toSpliced(index + 1, 0, row)
    })
  }

  const updateRow = ({ id, patch }: UpdateRowParams) =>
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))

  const removeRow = (id: number) => {
    setFocusId(null)
    setRows((current) => {
      const remaining = current.filter((row) => row.id !== id)
      return remaining.length ? remaining : rowsOf({ entries: [], nextIdRef })
    })
  }

  /** 붙여 넣은 줄을 행으로 나눈다. 붙여 넣은 행이 비어 있었으면 그 자리를 대신한다 */
  const pasteRows = ({ id, text }: PasteRowsParams) => {
    const pasted = withIds({ entries: parseTermLines(text), nextIdRef })
    if (!pasted.length) return

    setFocusId(null)
    setRows((current) =>
      current.flatMap((row) => {
        if (row.id !== id) return [row]
        return isBlank(row) ? pasted : [row, ...pasted]
      })
    )
  }

  return { rows, focusId, termLines, resetRows, addRow, updateRow, removeRow, pasteRows }
}

export default useTermRows
