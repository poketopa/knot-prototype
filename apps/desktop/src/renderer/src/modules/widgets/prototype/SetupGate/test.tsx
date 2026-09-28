// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
vi.mock('@renderer/shared/api/setup', () => ({ getSetupStatusApi: vi.fn() }))
import { getSetupStatusApi } from '@renderer/shared/api/setup'
import SetupGate from './index'

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const renderGate = () =>
  render(
    <SetupGate renderSetup={(complete) => <button onClick={complete}>초기 설정 완료</button>}>
      <div>문서와 녹음 화면</div>
    </SetupGate>
  )

describe('최초 설정 화면 진입', () => {
  it('설정 완료 전에는 앱을 마운트하지 않고 완료하면 앱을 연다', async () => {
    vi.mocked(getSetupStatusApi).mockResolvedValue({ isComplete: false })
    renderGate()
    const complete = await screen.findByRole('button', { name: '초기 설정 완료' })
    expect(screen.queryByText('문서와 녹음 화면')).toBeNull()
    await userEvent.click(complete)
    expect(screen.getByText('문서와 녹음 화면')).toBeTruthy()
  })
  it('다시 실행한 앱은 저장된 완료 상태에 따라 설정을 건너뛴다', async () => {
    vi.mocked(getSetupStatusApi).mockResolvedValue({ isComplete: true })
    renderGate()
    expect(await screen.findByText('문서와 녹음 화면')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '초기 설정 완료' })).toBeNull()
  })
  it('조회 실패를 완료로 처리하지 않고 다시 시도한다', async () => {
    vi.mocked(getSetupStatusApi)
      .mockRejectedValueOnce(new Error('IPC failure'))
      .mockResolvedValueOnce({ isComplete: false })
    renderGate()
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText('문서와 녹음 화면')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByRole('button', { name: '초기 설정 완료' })).toBeTruthy()
  })
})
