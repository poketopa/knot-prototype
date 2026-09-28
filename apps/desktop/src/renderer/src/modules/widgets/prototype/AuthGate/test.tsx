// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
vi.mock('@renderer/shared/api/prototype', () => ({
  getAuthStateApi: vi.fn(),
  loginApi: vi.fn(),
  onPrototypeChanged: vi.fn(() => () => {})
}))
import { getAuthStateApi, loginApi, onPrototypeChanged } from '@renderer/shared/api/prototype'
import AuthGate from './index'
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
describe('개인 자료 인증 가드', () => {
  it('로그인 전 개인 자료를 렌더하지 않고 서버 미설정을 알려준다', async () => {
    vi.mocked(getAuthStateApi).mockResolvedValue({ isAuthenticated: false, user: null })
    vi.mocked(loginApi).mockRejectedValue(new Error('GitHub 로그인이 아직 설정되지 않았습니다.'))
    render(
      <AuthGate>
        <div>개인 문서 내용</div>
      </AuthGate>
    )
    await userEvent.click(await screen.findByRole('button', { name: 'GitHub로 시작하기' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText('개인 문서 내용')).toBeNull()
  })
  it('로그아웃 이벤트를 받으면 열린 개인 문서를 즉시 제거한다', async () => {
    vi.mocked(getAuthStateApi).mockResolvedValue({
      isAuthenticated: true,
      user: { id: 'a', displayName: 'A' }
    })
    render(
      <AuthGate>
        <div>개인 문서 내용</div>
      </AuthGate>
    )
    expect(await screen.findByText('개인 문서 내용')).toBeTruthy()
    vi.mocked(getAuthStateApi).mockResolvedValue({ isAuthenticated: false, user: null })
    await act(async () => {
      vi.mocked(onPrototypeChanged).mock.calls[0][0]({ reason: 'auth' })
    })
    expect(await screen.findByRole('button', { name: 'GitHub로 시작하기' })).toBeTruthy()
    expect(screen.queryByText('개인 문서 내용')).toBeNull()
  })
})
