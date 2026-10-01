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

vi.mock('@renderer/shared/api/clipboard', () => ({
  writeClipboardTextApi: vi.fn().mockResolvedValue(undefined)
}))

import { getTranscriptApi, trackApi } from '@renderer/shared/api/prototype'
import { writeClipboardTextApi } from '@renderer/shared/api/clipboard'

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

  it('artifactId가 바뀌면 이전 원문을 숨기고 정확한 artifact로 다시 요청한다', async () => {
    let resolveNext: (value: PrototypeTranscript) => void = () => {}
    vi.mocked(getTranscriptApi)
      .mockResolvedValueOnce(transcript('r1', '첫 artifact 원문입니다.'))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNext = resolve
          })
      )

    const { rerender } = render(<TranscriptPanel recordingId="r1" artifactId="artifact-a" />)
    expect(await screen.findByText(/첫 artifact 원문입니다/)).toBeTruthy()

    rerender(<TranscriptPanel recordingId="r1" artifactId="artifact-b" />)

    expect(screen.queryByText(/첫 artifact 원문입니다/)).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('원문을 불러오고 있어요')
    expect(getTranscriptApi).toHaveBeenLastCalledWith('r1', 'artifact-b')

    resolveNext(transcript('r1', '두 번째 artifact 원문입니다.'))

    expect(await screen.findByText(/두 번째 artifact 원문입니다/)).toBeTruthy()
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

  it('날짜·녹음 시간 줄의 복사 버튼으로 시각과 참여자를 포함한 원문을 복사한다', async () => {
    vi.mocked(getTranscriptApi).mockResolvedValue({
      ...transcript('r1', '첫 발화입니다. '),
      durationSec: 95,
      utterances: [
        ...transcript('r1', '첫 발화입니다. ').utterances,
        {
          id: 'r1-u2',
          meetingId: 'r1',
          ord: 1,
          startSec: 75,
          endSec: 80,
          speakerLabel: 's1',
          text: '두 번째 발화입니다.'
        }
      ]
    })

    render(<TranscriptPanel recordingId="r1" />)

    const duration = await screen.findByText('1분 35초')
    const copyButton = screen.getByRole('button', { name: '복사' })
    expect(copyButton.parentElement).toBe(duration.parentElement)

    await userEvent.click(copyButton)

    expect(writeClipboardTextApi).toHaveBeenCalledWith({
      text: [
        '2026년 9월 20일 녹음 · 1분 35초',
        '',
        '[00:15] 참여자 1: 첫 발화입니다.',
        '[01:15] 참여자 2: 두 번째 발화입니다.'
      ].join('\n')
    })
    expect(trackApi).toHaveBeenCalledWith({ eventType: 'copied', recordingId: 'r1' })
  })

  it('발화가 없으면 복사 버튼을 표시하지 않는다', async () => {
    vi.mocked(getTranscriptApi).mockResolvedValue({ ...transcript('r1', ''), utterances: [] })

    render(<TranscriptPanel recordingId="r1" />)

    expect(await screen.findByText('기록된 발화가 없습니다.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '복사' })).toBeNull()
  })
})
