// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const recordingState = vi.hoisted(() => ({ isRecording: false }))
const prototypeEvents = vi.hoisted(() => ({
  listener: null as null | ((event: { reason: string }) => void)
}))

vi.mock('@renderer/shared/hooks/domain/recording/useRecordingState', () => ({
  default: () => ({ isRecording: recordingState.isRecording })
}))
vi.mock('@renderer/shared/api/prototype', () => ({
  getDocumentClassificationStateApi: vi.fn(),
  startDocumentClassificationApi: vi.fn(),
  onPrototypeChanged: vi.fn((listener: (event: { reason: string }) => void) => {
    prototypeEvents.listener = listener
    return () => {}
  })
}))

import {
  getDocumentClassificationStateApi,
  startDocumentClassificationApi
} from '@renderer/shared/api/prototype'
import DocumentClassificationSection from './index'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  recordingState.isRecording = false
  prototypeEvents.listener = null
})

describe('DocumentClassificationSection', () => {
  it('starts classification and refreshes the status', async () => {
    vi.mocked(getDocumentClassificationStateApi)
      .mockResolvedValueOnce({ status: 'idle' })
      .mockResolvedValueOnce({ status: 'completed', documentCount: 3 })
    vi.mocked(startDocumentClassificationApi).mockResolvedValue({ status: 'running' })

    render(<DocumentClassificationSection />)

    expect(await screen.findByText('문서 폴더 분류만 다시 계산할 수 있습니다.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '문서 분류 다시 실행' }))

    await waitFor(() => expect(startDocumentClassificationApi).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/3개 문서를 확인했어요/)).toBeTruthy()
  })

  it('blocks classification while recording is running', async () => {
    recordingState.isRecording = true
    vi.mocked(getDocumentClassificationStateApi).mockResolvedValue({ status: 'idle' })

    render(<DocumentClassificationSection />)

    const button = await screen.findByRole('button', { name: '문서 분류 다시 실행' })
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('녹음 중에는 문서 분류를 다시 실행할 수 없습니다.')).toBeTruthy()
  })

  it('refreshes when document state changes', async () => {
    vi.mocked(getDocumentClassificationStateApi)
      .mockResolvedValueOnce({ status: 'idle' })
      .mockResolvedValueOnce({ status: 'completed', documentCount: 1 })

    render(<DocumentClassificationSection />)
    expect(await screen.findByText('문서 폴더 분류만 다시 계산할 수 있습니다.')).toBeTruthy()

    prototypeEvents.listener?.({ reason: 'documents' })

    expect(await screen.findByText(/1개 문서를 확인했어요/)).toBeTruthy()
    expect(getDocumentClassificationStateApi).toHaveBeenCalledTimes(2)
  })
})
