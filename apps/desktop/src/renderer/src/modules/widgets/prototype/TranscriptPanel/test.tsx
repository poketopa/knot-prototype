// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PrototypeTranscript } from '@shared/prototype'
import TranscriptPanel from './index'

vi.mock('@renderer/shared/api/prototype', () => ({
  getTranscriptApi: vi.fn(),
  trackApi: vi.fn().mockResolvedValue(undefined)
}))

import { getTranscriptApi, trackApi } from '@renderer/shared/api/prototype'

const transcript = (recordingId: string, text: string): PrototypeTranscript => ({
  recordingId,
  title: '회의',
  startedAt: '2026-09-20T10:00:00Z',
  utterances: [
    {
      id: `${recordingId}-u1`,
      meetingId: recordingId,
      ord: 0,
      startSec: 15,
      endSec: 20,
      speakerLabel: 's0',
      text
    }
  ]
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TranscriptPanel', () => {
  it('원문 로딩 실패를 친절한 문장으로 표시하고 다시 불러올 수 있다', async () => {
    vi.mocked(getTranscriptApi)
      .mockRejectedValueOnce(new Error('Error: 네트워크가 불안정합니다.'))
      .mockResolvedValueOnce(transcript('r1', '재시도 후 원문입니다.'))

    render(<TranscriptPanel recordingId="r1" />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('네트워크가 불안정합니다.')
    expect(alert.textContent).not.toContain('Error:')

    await userEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))

    expect(await screen.findByText(/재시도 후 원문입니다/)).toBeTruthy()
    expect(getTranscriptApi).toHaveBeenCalledTimes(2)
    await waitFor(() =>
      expect(trackApi).toHaveBeenCalledWith({ eventType: 'transcript_viewed', recordingId: 'r1' })
    )
  })

  it('새 recordingId로 바뀐 뒤 늦게 도착한 이전 응답을 표시하지 않는다', async () => {
    let resolveOld: (value: PrototypeTranscript) => void = () => {}
    vi.mocked(getTranscriptApi).mockImplementation((recordingId: string) => {
      if (recordingId === 'r1') {
        return new Promise((resolve) => {
          resolveOld = resolve
        })
      }
      return Promise.resolve(transcript('r2', '두 번째 회의 원문입니다.'))
    })

    const { rerender } = render(<TranscriptPanel recordingId="r1" />)
    rerender(<TranscriptPanel recordingId="r2" />)
    resolveOld(transcript('r1', '이전 회의 원문입니다.'))

    expect(await screen.findByText(/두 번째 회의 원문입니다/)).toBeTruthy()
    expect(screen.queryByText(/이전 회의 원문입니다/)).toBeNull()
  })

  it('응답에 녹음 시간이 있으면 날짜 옆 배지로 표시한다', async () => {
    vi.mocked(getTranscriptApi).mockResolvedValue({
      ...transcript('r1', '시간 배지가 있는 원문입니다.'),
      durationSec: 125
    } as PrototypeTranscript & { durationSec: number })

    render(<TranscriptPanel recordingId="r1" />)

    expect(await screen.findByText('2분 5초')).toBeTruthy()
    expect(screen.getByLabelText('전사 원문')).toBeTruthy()
  })
})
