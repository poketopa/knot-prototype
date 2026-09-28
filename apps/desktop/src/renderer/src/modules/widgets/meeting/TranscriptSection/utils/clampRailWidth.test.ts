import { describe, expect, it } from 'vitest'

import { RAIL_MAX_PX, RAIL_MIN_PX } from '../constants/rail'
import { clampRailWidth, railMaxWidthOf } from './clampRailWidth'

describe('railMaxWidthOf', () => {
  it('측정 전(폭 0)이면 고정 상한을 쓴다', () => {
    expect(railMaxWidthOf({ contentWidth: 0 })).toBe(RAIL_MAX_PX)
  })

  it('본문이 좁으면 절반까지만 허용한다', () => {
    expect(railMaxWidthOf({ contentWidth: 700 })).toBe(350)
  })

  it('본문이 넓어도 고정 상한을 넘지 않는다', () => {
    expect(railMaxWidthOf({ contentWidth: 2000 })).toBe(RAIL_MAX_PX)
  })

  it('본문이 아주 좁아도 최소 폭 아래로 내려가지 않는다', () => {
    expect(railMaxWidthOf({ contentWidth: 300 })).toBe(RAIL_MIN_PX)
  })
})

describe('clampRailWidth', () => {
  it('범위 안의 값은 반올림만 한다', () => {
    expect(clampRailWidth({ width: 320.6, maxWidth: RAIL_MAX_PX })).toBe(321)
  })

  it('최소·최대 폭으로 자른다', () => {
    expect(clampRailWidth({ width: 100, maxWidth: RAIL_MAX_PX })).toBe(RAIL_MIN_PX)
    expect(clampRailWidth({ width: 900, maxWidth: 400 })).toBe(400)
  })
})
