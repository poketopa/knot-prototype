// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import Stepper from './index'

const MIN = 1
const MAX = 3
const LABEL = '참석자 수'

const renderStepper = (value: string) => {
  const onChange = vi.fn()
  render(
    <Stepper
      value={value}
      onChange={onChange}
      min={MIN}
      max={MAX}
      label={LABEL}
      placeholder="모름"
    />
  )
  return { onChange }
}

const getDecrement = () =>
  screen.getByRole<HTMLButtonElement>('button', { name: `${LABEL} 줄이기` })
const getIncrement = () =>
  screen.getByRole<HTMLButtonElement>('button', { name: `${LABEL} 늘리기` })

afterEach(cleanup)

describe('Stepper', () => {
  it('빈 값에서 +를 누르면 최솟값부터 시작하고 −는 비활성이다', async () => {
    const { onChange } = renderStepper('')

    expect(getDecrement().disabled).toBe(true)
    await userEvent.click(getIncrement())
    expect(onChange).toHaveBeenCalledWith(String(MIN))
  })

  it('최솟값에서 −를 누르면 값을 비운다', async () => {
    const { onChange } = renderStepper(String(MIN))

    await userEvent.click(getDecrement())
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('최댓값에서는 +가 비활성이고 −는 하나 줄인다', async () => {
    const { onChange } = renderStepper(String(MAX))

    expect(getIncrement().disabled).toBe(true)
    await userEvent.click(getDecrement())
    expect(onChange).toHaveBeenCalledWith(String(MAX - 1))
  })

  it('범위를 넘는 값에서 −를 누르면 최댓값으로 끌어온다', async () => {
    const { onChange } = renderStepper('30')

    await userEvent.click(getDecrement())
    expect(onChange).toHaveBeenCalledWith(String(MAX))
  })

  it('정수가 아닌 값에서 +를 누르면 최솟값으로 바꾼다', async () => {
    const { onChange } = renderStepper('두명')

    await userEvent.click(getIncrement())
    expect(onChange).toHaveBeenCalledWith(String(MIN))
  })

  it('직접 입력한 문자열을 그대로 부모에 넘긴다', async () => {
    const { onChange } = renderStepper('')

    await userEvent.type(screen.getByRole('textbox', { name: LABEL }), '2')
    expect(onChange).toHaveBeenCalledWith('2')
  })
})
