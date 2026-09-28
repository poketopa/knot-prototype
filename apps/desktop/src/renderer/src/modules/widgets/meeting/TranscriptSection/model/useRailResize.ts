import { useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, RefObject } from 'react'

import {
  RAIL_DEFAULT_PX,
  RAIL_KEYBOARD_STEP_PX,
  RAIL_MAX_PX,
  RAIL_WIDTH_STORAGE_KEY
} from '../constants/rail'
import { clampRailWidth, railMaxWidthOf } from '../utils/clampRailWidth'

// 레일이 오른쪽에 있으므로 핸들을 왼쪽으로 옮길수록 넓어진다
const KEY_DELTAS: Record<string, number> = {
  ArrowLeft: RAIL_KEYBOARD_STEP_PX,
  ArrowRight: -RAIL_KEYBOARD_STEP_PX
}

interface DragState {
  startX: number
  startWidth: number
  maxWidth: number
}

// 폭은 화면 선호일 뿐이라 저장소를 못 쓰면 기본 폭으로 계속 동작한다 (references/architecture.md "화면별 구성")
const readSavedWidth = () => {
  try {
    const saved = Number(localStorage.getItem(RAIL_WIDTH_STORAGE_KEY))
    if (!Number.isFinite(saved) || saved <= 0) return RAIL_DEFAULT_PX
    return clampRailWidth({ width: saved, maxWidth: RAIL_MAX_PX })
  } catch (error) {
    console.warn('레일 폭을 불러오지 못했습니다', error)
    return RAIL_DEFAULT_PX
  }
}

const saveWidth = (width: number) => {
  try {
    localStorage.setItem(RAIL_WIDTH_STORAGE_KEY, String(width))
  } catch (error) {
    console.warn('레일 폭을 저장하지 못했습니다', error)
  }
}

const contentWidthOf = (container: HTMLElement | null) => {
  if (!container) return 0
  const style = getComputedStyle(container)
  const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
  return container.clientWidth - padding
}

interface UseRailResizeParams {
  /** 회의록과 레일을 담은 그리드. 창 폭에 따른 상한을 여기서 잰다 */
  containerRef: RefObject<HTMLElement | null>
}

const useRailResize = ({ containerRef }: UseRailResizeParams) => {
  const [railWidth, setRailWidth] = useState(readSavedWidth)
  const [isResizing, setIsResizing] = useState(false)
  const dragRef = useRef<DragState | null>(null)

  const measureMaxWidth = () =>
    railMaxWidthOf({ contentWidth: contentWidthOf(containerRef.current) })

  const commitWidth = (width: number) => {
    const next = clampRailWidth({ width, maxWidth: measureMaxWidth() })
    setRailWidth(next)
    saveWidth(next)
  }

  const startResize = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    const maxWidth = measureMaxWidth()
    // 창이 줄어 저장된 폭이 상한을 넘은 상태면 보이는 폭에서 시작해야 끌 때 헛도는 구간이 없다
    dragRef.current = {
      startX: event.clientX,
      startWidth: Math.min(railWidth, maxWidth),
      maxWidth
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsResizing(true)
  }

  const moveResize = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const width = drag.startWidth + drag.startX - event.clientX
    setRailWidth(clampRailWidth({ width, maxWidth: drag.maxWidth }))
  }

  const endResize = () => {
    if (!dragRef.current) return
    dragRef.current = null
    setIsResizing(false)
    saveWidth(railWidth)
  }

  const resizeByKey = (event: KeyboardEvent<HTMLElement>) => {
    const delta = KEY_DELTAS[event.key]
    if (!delta) return
    event.preventDefault()
    commitWidth(Math.min(railWidth, measureMaxWidth()) + delta)
  }

  const resetWidth = () => commitWidth(RAIL_DEFAULT_PX)

  return { railWidth, isResizing, startResize, moveResize, endResize, resizeByKey, resetWidth }
}

export default useRailResize
