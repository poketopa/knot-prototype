import type { KeyboardEvent, PointerEvent } from 'react'

import { RAIL_MAX_PX, RAIL_MIN_PX } from '../constants/rail'
import styles from './RailResizer.module.css'

interface RailResizerProps {
  railWidth: number
  isResizing: boolean
  onPointerDown: (event: PointerEvent<HTMLElement>) => void
  onPointerMove: (event: PointerEvent<HTMLElement>) => void
  onPointerEnd: () => void
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  onReset: () => void
}

/** 회의록과 레일 사이의 세로 핸들. 끌거나 ←/→로 레일 폭을 바꾸고, 더블클릭하면 기본 폭으로 돌린다 */
export default function RailResizer({
  railWidth,
  isResizing,
  onPointerDown,
  onPointerMove,
  onPointerEnd,
  onKeyDown,
  onReset
}: RailResizerProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="오른쪽 패널 폭 조절"
      aria-valuenow={railWidth}
      aria-valuemin={RAIL_MIN_PX}
      aria-valuemax={RAIL_MAX_PX}
      tabIndex={0}
      title="끌어서 폭 조절 · 더블클릭하면 원래 폭으로"
      className={styles.resizer}
      data-resizing={isResizing}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
    />
  )
}
