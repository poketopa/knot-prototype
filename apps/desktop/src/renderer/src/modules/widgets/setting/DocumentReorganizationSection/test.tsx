// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DocumentReorganizationSection from './index'

vi.mock('@renderer/shared/api/prototype', () => ({
  reanalyzeDocumentsApi: vi.fn()
}))

vi.mock('@renderer/shared/hooks/domain/recording/useRecordingState', () => ({
  default: vi.fn(() => ({
    isRecording: false,
    meetingId: null,
    level: 0,
    levels: [],
    speakerCount: undefined,
    errorMessage: undefined,
    elapsedSec: 0
  }))
}))

import { reanalyzeDocumentsApi } from '@renderer/shared/api/prototype'
import useRecordingState from '@renderer/shared/hooks/domain/recording/useRecordingState'

const idleRecordingState = {
  isRecording: false,
  meetingId: null,
  level: 0,
  levels: [],
  speakerCount: undefined,
  errorMessage: undefined,
  elapsedSec: 0
}

beforeEach(() => {
  vi.mocked(useRecordingState).mockReturnValue(idleRecordingState)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DocumentReorganizationSection', () => {
  it('does not run automatically and shows progress only after the user clicks', async () => {
    const user = userEvent.setup()
    let resolve!: () => void
    vi.mocked(reanalyzeDocumentsApi).mockReturnValue(
      new Promise((done) => {
        resolve = () => done({ requested: 4, processed: 4, skipped: 0, failed: 0, failures: [] })
      })
    )

    render(<DocumentReorganizationSection />)

    expect(screen.getByText('아직 실행하지 않았습니다.')).toBeTruthy()
    expect(reanalyzeDocumentsApi).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '기존 문서 다시 정리' }))

    expect(reanalyzeDocumentsApi).toHaveBeenCalledTimes(1)
    expect(screen.getByText('기존 문서를 다시 정리하는 중입니다.')).toBeTruthy()
    expect(screen.getByRole('button', { name: '다시 정리 중…' }).hasAttribute('disabled')).toBe(
      true
    )

    resolve()

    expect(await screen.findByText(/4개 중 4개 다시 정리/)).toBeTruthy()
  })

  it('blocks reanalysis while recording is running', () => {
    vi.mocked(useRecordingState).mockReturnValue({
      ...idleRecordingState,
      isRecording: true,
      meetingId: 'meeting-1',
      elapsedSec: 10
    })

    render(<DocumentReorganizationSection />)

    expect(screen.getByText(/녹음 중에는 기존 문서를 다시 정리할 수 없습니다/)).toBeTruthy()
    expect(
      screen.getByRole('button', { name: '기존 문서 다시 정리' }).hasAttribute('disabled')
    ).toBe(true)
  })

  it('shows failure preservation copy and allows retry', async () => {
    const user = userEvent.setup()
    vi.mocked(reanalyzeDocumentsApi)
      .mockResolvedValueOnce({
        requested: 3,
        processed: 2,
        skipped: 0,
        failed: 1,
        failures: [{ recordingId: 'r1', title: '실패한 회의', error: 'AI 모델 실행 실패' }]
      })
      .mockResolvedValueOnce({ requested: 3, processed: 3, skipped: 0, failed: 0, failures: [] })

    render(<DocumentReorganizationSection />)

    await user.click(screen.getByRole('button', { name: '기존 문서 다시 정리' }))

    expect(await screen.findByText(/AI 모델 실행 실패/)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('기존 문서는 그대로 보존')

    await user.click(screen.getByRole('button', { name: '다시 시도' }))

    expect(reanalyzeDocumentsApi).toHaveBeenCalledTimes(2)
    expect(await screen.findByText(/3개 중 3개 다시 정리/)).toBeTruthy()
  })
})
