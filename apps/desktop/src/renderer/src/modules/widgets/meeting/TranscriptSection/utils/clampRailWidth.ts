import { RAIL_MAX_PX, RAIL_MAX_RATIO, RAIL_MIN_PX } from '../constants/rail'

interface RailMaxWidthOfParams {
  /** 본문 그리드의 콘텐츠 폭(패딩 제외). 0이면 아직 측정 전으로 본다 */
  contentWidth: number
}

export const railMaxWidthOf = ({ contentWidth }: RailMaxWidthOfParams) => {
  if (contentWidth <= 0) return RAIL_MAX_PX
  return Math.max(RAIL_MIN_PX, Math.min(RAIL_MAX_PX, Math.floor(contentWidth * RAIL_MAX_RATIO)))
}

interface ClampRailWidthParams {
  width: number
  maxWidth: number
}

export const clampRailWidth = ({ width, maxWidth }: ClampRailWidthParams) =>
  Math.round(Math.min(maxWidth, Math.max(RAIL_MIN_PX, width)))
