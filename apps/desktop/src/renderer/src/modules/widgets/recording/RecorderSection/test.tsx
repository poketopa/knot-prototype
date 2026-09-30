// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RecordingStateEvent } from '@shared/ipc'

vi.mock('@renderer/shared/api/recording', () => ({
  getRecordingStateApi: vi.fn(),
  controlRecordingApi: vi.fn(),
  setSpeakerCountApi: vi.fn()
}))

vi.mock('@renderer/shared/api/events', () => ({ onRecordingState: vi.fn() }))
vi.mock('@renderer/shared/api/settings', () => ({
  getSettingsApi: vi.fn().mockResolvedValue({ recordingShortcut: 'Alt+Command+R' })
}))

import { onRecordingState } from '@renderer/shared/api/events'
import {
  controlRecordingApi,
  getRecordingStateApi,
  setSpeakerCountApi
} from '@renderer/shared/api/recording'
import RecorderSection from './index'

const MEETING_ID = 'meeting-1'
const IDLE_STATE: RecordingStateEvent = { meetingId: null, startedAt: null, level: 0 }

/** main이 보내는 상태 이벤트를 테스트에서 직접 흘려보내기 위해 구독자를 잡아 둔다 */
let pushState: (event: RecordingStateEvent) => void = () => {}

beforeEach(() => {
  vi.mocked(onRecordingState).mockImplementation((listener) => {
    pushState = listener

    return () => {}
  })
  vi.mocked(getRecordingStateApi).mockResolvedValue(IDLE_STATE)
  vi.mocked(controlRecordingApi).mockResolvedValue(undefined)
  vi.mocked(setSpeakerCountApi).mockResolvedValue(IDLE_STATE)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('RecorderSection', () => {
  it('가로 녹음 컨트롤과 안내 카드를 보여준다', () => {
    render(<RecorderSection />)

    expect(screen.getByText('대기 중')).toBeTruthy()
    expect(screen.getByRole('meter', { name: '마이크 입력 세기' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '지금의 대화를 기록해요' })).toBeTruthy()
    expect(screen.getByText(/주제별 핵심과 논의 상세를 문서로/)).toBeTruthy()
  })

  it('녹음 시작을 누르면 main에 시작 명령을 보낸다', async () => {
    const user = userEvent.setup()
    render(<RecorderSection />)

    await user.click(screen.getByRole('button', { name: '녹음 시작' }))

    expect(controlRecordingApi).toHaveBeenCalledWith({ kind: 'start' })
  })

  it('다른 창에서 시작한 녹음의 경과 시간과 정지 버튼을 보여준다', async () => {
    const user = userEvent.setup()
    render(<RecorderSection />)

    act(() => {
      pushState({ meetingId: MEETING_ID, startedAt: Date.now() - 125_000, level: 0.2 })
    })

    expect(screen.getByText('02:05')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '녹음 종료' }))

    expect(controlRecordingApi).toHaveBeenCalledWith({ kind: 'stop' })
  })

  it('참석자 수를 입력하면 세션에 저장한다', async () => {
    const user = userEvent.setup()
    render(<RecorderSection />)

    await user.type(screen.getByLabelText('참석자 수'), '4')

    expect(setSpeakerCountApi).toHaveBeenCalledWith({ speakerCount: 4 })
  })

  it('다른 창에서 바꾼 참석자 수를 그대로 보여준다', () => {
    render(<RecorderSection />)

    act(() => {
      pushState({ ...IDLE_STATE, speakerCount: 7 })
    })

    expect((screen.getByLabelText('참석자 수') as HTMLInputElement).value).toBe('7')
  })

  it('범위를 벗어난 참석자 수는 보내지 않고 안내한다', async () => {
    const user = userEvent.setup()
    render(<RecorderSection />)

    await user.type(screen.getByLabelText('참석자 수'), '99')

    expect(setSpeakerCountApi).not.toHaveBeenCalledWith({ speakerCount: 99 })
    expect(screen.getByText(/1~20 사이의 정수만 쓸 수 있습니다/)).toBeTruthy()
  })

  it('위젯에서 일어난 녹음 실패를 메인 창에도 보여준다', () => {
    render(<RecorderSection />)

    act(() => {
      pushState({ ...IDLE_STATE, errorMessage: '마이크 사용 권한이 없습니다' })
    })

    expect(screen.getByRole('alert').textContent).toBe('마이크 사용 권한이 없습니다')
  })

  it('명령 전달에 실패하면 안내를 보여준다', async () => {
    const user = userEvent.setup()
    vi.mocked(controlRecordingApi).mockRejectedValue(new Error('연결 실패'))
    render(<RecorderSection />)

    await user.click(screen.getByRole('button', { name: '녹음 시작' }))

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(/녹음 요청을 보내지 못했습니다/)).toBeTruthy()
  })
})
