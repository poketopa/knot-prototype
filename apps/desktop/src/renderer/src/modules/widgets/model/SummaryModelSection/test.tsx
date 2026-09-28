// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ModelDownloadProgressEvent, ModelStatusResponse } from '@shared/ipc'

vi.mock('@renderer/shared/api/models', () => ({
  getModelStatusApi: vi.fn(),
  downloadModelsApi: vi.fn(),
  downloadSummaryModelApi: vi.fn()
}))
vi.mock('@renderer/shared/api/events', () => ({
  onModelDownloadProgress: vi.fn(() => () => {})
}))

import { onModelDownloadProgress } from '@renderer/shared/api/events'
import { downloadSummaryModelApi, getModelStatusApi } from '@renderer/shared/api/models'
import SummaryModelSection from './index'

const SUMMARY_BYTES = 2497281120

const statusOf = (isInstalled: boolean): ModelStatusResponse => ({
  isReady: true,
  isSummaryReady: isInstalled,
  selectedWhisperModelId: 'turbo-q5',
  recommendedWhisperModelId: 'turbo-q5',
  whisperOptions: [],
  items: [
    { key: 'summary', label: '요약 모델', sizeBytes: SUMMARY_BYTES, isInstalled, isRequired: false }
  ]
})

const renderSection = async (status: ModelStatusResponse) => {
  vi.mocked(getModelStatusApi).mockResolvedValue(status)

  await act(async () => {
    render(<SummaryModelSection />)
  })
}

const emitProgress = async (event: ModelDownloadProgressEvent) => {
  const listener = vi.mocked(onModelDownloadProgress).mock.calls.at(-1)?.[0]

  await act(async () => {
    listener?.(event)
  })
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SummaryModelSection', () => {
  it('요약 모델이 없으면 용량과 함께 다운로드 버튼을 보여준다', async () => {
    await renderSection(statusOf(false))

    expect(screen.getByRole('button', { name: '모델 파일 받기' })).toBeTruthy()
    expect(screen.getByText(/설치되지 않음 · 2.5GB/)).toBeTruthy()
    expect(screen.getByText(/Codex CLI나 Claude Code를 고르면 필요 없습니다/)).toBeTruthy()
  })

  it('설치돼 있으면 버튼 대신 설치됨을 보여준다', async () => {
    await renderSection(statusOf(true))

    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('설치되어 있습니다')).toBeTruthy()
  })

  it('버튼을 누르면 진행률을 보여주고 끝나면 설치됨으로 바뀐다', async () => {
    const user = userEvent.setup()
    let finish: (status: ModelStatusResponse) => void = () => {}
    vi.mocked(downloadSummaryModelApi).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    await renderSection(statusOf(false))

    await user.click(screen.getByRole('button', { name: '모델 파일 받기' }))

    expect(downloadSummaryModelApi).toHaveBeenCalledTimes(1)
    await emitProgress({ key: 'summary', receivedBytes: 1, totalBytes: SUMMARY_BYTES, percent: 30 })
    expect(
      screen
        .getByRole('progressbar', { name: '요약 모델 다운로드 진행률' })
        .getAttribute('aria-valuenow')
    ).toBe('30')

    await act(async () => {
      finish(statusOf(true))
    })

    expect(screen.getByText('설치되어 있습니다')).toBeTruthy()
  })

  it('실패하면 안내를 보여주고 다시 받을 수 있다', async () => {
    const user = userEvent.setup()
    vi.mocked(downloadSummaryModelApi).mockRejectedValue(new Error('이미 모델을 내려받는 중입니다'))
    await renderSection(statusOf(false))

    await user.click(screen.getByRole('button', { name: '모델 파일 받기' }))

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('이미 모델을 내려받는 중입니다')).toBeTruthy()
    expect(screen.getByRole('button', { name: '모델 파일 받기' })).toBeTruthy()
  })
})
