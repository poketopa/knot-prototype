// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import Switch from './index'

afterEach(cleanup)

describe('Switch', () => {
  it('누르면 반대 값으로 onChange를 부른다', async () => {
    const onChange = vi.fn()
    render(<Switch isChecked={false} onChange={onChange} ariaLabel="원본 녹음 보관" />)

    const toggle = screen.getByRole('switch', { name: '원본 녹음 보관' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')

    await userEvent.click(toggle)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('키보드 Space로도 토글된다', async () => {
    const onChange = vi.fn()
    render(<Switch isChecked onChange={onChange} ariaLabel="조용히 처리" />)

    screen.getByRole('switch').focus()
    await userEvent.keyboard(' ')
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('보이는 제목을 접근성 이름으로 쓸 수 있다', () => {
    render(
      <>
        <span id="setting-title">업데이트 자동 확인</span>
        <Switch isChecked onChange={vi.fn()} ariaLabelledBy="setting-title" />
      </>
    )

    expect(screen.getByRole('switch', { name: '업데이트 자동 확인' })).toBeTruthy()
  })

  it('비활성이면 눌러도 바뀌지 않는다', async () => {
    const onChange = vi.fn()
    render(<Switch isChecked={false} onChange={onChange} ariaLabel="보관" disabled />)

    await userEvent.click(screen.getByRole('switch'))
    expect(onChange).not.toHaveBeenCalled()
  })
})
