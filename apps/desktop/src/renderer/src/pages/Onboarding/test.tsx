// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@renderer/modules/widgets/model/ModelDownloadSection', () => ({
  default: ({ onComplete }: { onComplete: () => void }) => (
    <button onClick={onComplete}>STT 모델 사용</button>
  )
}))
vi.mock('@renderer/modules/widgets/model/SummaryModelSection', () => ({
  default: () => <div>로컬 요약 모델</div>
}))
vi.mock('@renderer/modules/widgets/setting/LlmSection', () => ({
  default: ({
    allowedProviders,
    showConnectionCheck
  }: {
    allowedProviders: string[]
    showConnectionCheck: boolean
  }) => (
    <div>
      AI 선택 {allowedProviders.join(',')}
      {showConnectionCheck ? <button>연결 확인</button> : null}
    </div>
  )
}))
vi.mock('@renderer/shared/api/setup', () => ({ completeSetupApi: vi.fn() }))

import { completeSetupApi } from '@renderer/shared/api/setup'
import Onboarding from './index'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Onboarding', () => {
  it('음성 인식 모델을 명시적으로 고른 뒤 초기 AI 선택지만 보여준다', async () => {
    const user = userEvent.setup()
    render(<Onboarding />)

    await user.click(screen.getByRole('button', { name: 'STT 모델 사용' }))

    expect(screen.getByText(/AI 선택 local,codex-cli,claude-cli/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '연결 확인' })).toBeNull()
  })

  it('완료 검증이 성공하면 앱 진입을 알린다', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    vi.mocked(completeSetupApi).mockResolvedValue({ isComplete: true })
    render(<Onboarding onComplete={onComplete} />)

    await user.click(screen.getByRole('button', { name: 'STT 모델 사용' }))
    await user.click(screen.getByRole('button', { name: '연결 확인하고 시작' }))

    expect(completeSetupApi).toHaveBeenCalledOnce()
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it('완료 검증이 실패하면 설정 완료로 넘기지 않는다', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    vi.mocked(completeSetupApi).mockRejectedValue(new Error('Codex CLI 로그인이 필요합니다'))
    render(<Onboarding onComplete={onComplete} />)

    await user.click(screen.getByRole('button', { name: 'STT 모델 사용' }))
    await user.click(screen.getByRole('button', { name: '연결 확인하고 시작' }))

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Codex CLI 로그인이 필요합니다'
    )
    expect(onComplete).not.toHaveBeenCalled()
  })
})
