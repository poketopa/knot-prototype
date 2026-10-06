// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { RecordingStateEvent } from '@shared/ipc'
import type { PrototypeChangedEvent, PrototypeProcessingItem } from '@shared/prototype'
import { useRecordReturnPath } from './useRecordReturnPath'

const { getProcessingApi, getRecordingStateApi, onPrototypeChanged } = vi.hoisted(() => ({
  getProcessingApi: vi.fn<() => Promise<PrototypeProcessingItem[]>>(),
  getRecordingStateApi: vi.fn<() => Promise<RecordingStateEvent>>(),
  onPrototypeChanged: vi.fn<(listener: (event: PrototypeChangedEvent) => void) => () => void>(
    () => () => {}
  )
}))

vi.mock('@renderer/shared/api/prototype', () => ({
  getProcessingApi,
  onPrototypeChanged
}))

vi.mock('@renderer/shared/api/recording', () => ({
  getRecordingStateApi
}))

const idleRecording = () =>
  ({ meetingId: null, startedAt: null, level: 0 }) satisfies RecordingStateEvent

const activeRecording = () =>
  ({ meetingId: 'live-meeting', startedAt: Date.now(), level: 0 }) satisfies RecordingStateEvent

const choosing = (meetingId: string) =>
  ({
    meetingId,
    title: meetingId,
    status: 'pending',
    stage: 'choosing',
    startedAt: '2026-10-06T06:00:00Z'
  }) satisfies PrototypeProcessingItem

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useRecordReturnPath', () => {
  it('does not redirect to a stale choosing job while recording state is pending, then keeps null for an active recording', async () => {
    const recording = deferred<RecordingStateEvent>()
    getRecordingStateApi.mockReturnValue(recording.promise)
    getProcessingApi.mockResolvedValue([choosing('old-meeting')])

    const { result } = renderHook(() => useRecordReturnPath())

    expect(result.current).toBeNull()
    expect(getProcessingApi).not.toHaveBeenCalled()

    await act(async () => {
      recording.resolve(activeRecording())
      await recording.promise
    })

    expect(result.current).toBeNull()
    expect(getProcessingApi).not.toHaveBeenCalled()
  })

  it('returns null immediately on the same render when disabled becomes true even if a path already exists', async () => {
    getRecordingStateApi.mockResolvedValue(idleRecording())
    getProcessingApi.mockResolvedValue([choosing('meeting-1')])

    const { result, rerender } = renderHook(({ disabled }) => useRecordReturnPath(disabled), {
      initialProps: { disabled: false }
    })

    await waitFor(() => expect(result.current).toBe('/processing/meeting-1'))

    rerender({ disabled: true })

    expect(result.current).toBeNull()
  })

  it('keeps the latest refresh result when an older processing response resolves later', async () => {
    const firstProcessing = deferred<PrototypeProcessingItem[]>()
    const secondProcessing = deferred<PrototypeProcessingItem[]>()
    let prototypeListener!: (event: PrototypeChangedEvent) => void
    getRecordingStateApi.mockResolvedValue(idleRecording())
    getProcessingApi
      .mockReturnValueOnce(firstProcessing.promise)
      .mockReturnValueOnce(secondProcessing.promise)
    onPrototypeChanged.mockImplementation((listener) => {
      prototypeListener = listener
      return () => {}
    })

    const { result } = renderHook(() => useRecordReturnPath())

    await waitFor(() => expect(getProcessingApi).toHaveBeenCalledTimes(1))

    act(() => {
      prototypeListener({ reason: 'processing' })
    })

    await waitFor(() => expect(getProcessingApi).toHaveBeenCalledTimes(2))

    await act(async () => {
      secondProcessing.resolve([choosing('latest-meeting')])
      await secondProcessing.promise
    })
    await waitFor(() => expect(result.current).toBe('/processing/latest-meeting'))

    await act(async () => {
      firstProcessing.resolve([choosing('stale-meeting')])
      await firstProcessing.promise
    })

    expect(result.current).toBe('/processing/latest-meeting')
  })

  it('keeps null after disabled is turned off again until the new processing result arrives', async () => {
    const nextProcessing = deferred<PrototypeProcessingItem[]>()
    getRecordingStateApi.mockResolvedValue(idleRecording())
    getProcessingApi
      .mockResolvedValueOnce([choosing('old-meeting')])
      .mockReturnValueOnce(nextProcessing.promise)

    const { result, rerender } = renderHook(({ disabled }) => useRecordReturnPath(disabled), {
      initialProps: { disabled: false }
    })

    await waitFor(() => expect(result.current).toBe('/processing/old-meeting'))

    rerender({ disabled: true })
    expect(result.current).toBeNull()

    rerender({ disabled: false })
    expect(result.current).toBeNull()

    await act(async () => {
      nextProcessing.resolve([choosing('new-meeting')])
      await nextProcessing.promise
    })

    await waitFor(() => expect(result.current).toBe('/processing/new-meeting'))
  })
})
