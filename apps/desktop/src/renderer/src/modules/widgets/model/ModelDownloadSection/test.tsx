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
import { downloadModelsApi, getModelStatusApi } from '@renderer/shared/api/models'
import ModelDownloadSection from './index'

const TURBO_BYTES = 574041195
const SMALL_BYTES = 190085487
const VAD_BYTES = 885098

const statusOf = (overrides: Partial<ModelStatusResponse> = {}): ModelStatusResponse => ({
  isReady: false,
  isSummaryReady: false,
  selectedWhisperModelId: 'turbo-q5',
  recommendedWhisperModelId: 'turbo-q5',
  whisperOptions: [
    { id: 'turbo-q5', label: '기본 (권장)', description: '균형', sizeBytes: TURBO_BYTES },
    { id: 'large-v3-q5', label: '고품질', description: '느림', sizeBytes: 1081140203 },
    { id: 'small-q5_1', label: '저사양', description: '오인식 증가', sizeBytes: SMALL_BYTES }
  ],
  items: [
    {
      key: 'whisper',
      label: '음성 인식 모델 (기본)',
      sizeBytes: TURBO_BYTES,
      isInstalled: false,
      isRequired: true
    },
    {
      key: 'vad',
      label: '무음 감지 모델',
      sizeBytes: VAD_BYTES,
      isInstalled: false,
      isRequired: true
    },
    {
      key: 'summary',
      label: '요약 모델',
      sizeBytes: 2497281120,
      isInstalled: false,
      isRequired: false
    }
  ],
  ...overrides
})

const readyStatus = () =>
  statusOf({
    isReady: true,
    items: [
      {
        key: 'whisper',
        label: '음성 인식 모델 (기본)',
        sizeBytes: TURBO_BYTES,
        isInstalled: true,
        isRequired: true
      },
      {
        key: 'vad',
        label: '무음 감지 모델',
        sizeBytes: VAD_BYTES,
        isInstalled: true,
        isRequired: true
      }
    ]
  })

const renderSection = async (status: ModelStatusResponse, onComplete?: () => void) => {
  vi.mocked(getModelStatusApi).mockResolvedValue(status)

  await act(async () => {
    render(<ModelDownloadSection onComplete={onComplete} />)
  })
}

/** main이 보내는 다운로드 진행 이벤트를 흉내 낸다 */
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

describe('ModelDownloadSection', () => {
  it('권장 모델을 미리 고른 채 선택지와 받을 용량, 네트워크 안내를 보여준다', async () => {
    await renderSection(statusOf())

    expect((screen.getByRole('radio', { name: /기본 \(권장\)/ }) as HTMLInputElement).checked).toBe(
      true
    )
    expect(screen.getByText('이 컴퓨터에 권장')).toBeTruthy()
    expect(screen.getByRole('button', { name: '다운로드 (575MB)' })).toBeTruthy()
    expect(screen.getByText(/음성 인식은 이 컴퓨터에서 실행합니다/)).toBeTruthy()
  })

  it('저사양 장비에서 권장보다 큰 모델을 고르면 안내를 붙인다', async () => {
    const user = userEvent.setup()
    await renderSection(statusOf({ recommendedWhisperModelId: 'small-q5_1' }))

    expect((screen.getByRole('radio', { name: /저사양/ }) as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByText(/처리 시간이 오래 걸릴 수 있습니다/)).toBeNull()

    await user.click(screen.getByRole('radio', { name: /기본 \(권장\)/ }))

    expect(screen.getByText(/처리 시간이 오래 걸릴 수 있습니다/)).toBeTruthy()
  })

  it('다운로드를 누르면 고른 모델을 요청하고 항목별 진행률을 보여준 뒤 완료를 알린다', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    let finish: (status: ModelStatusResponse) => void = () => {}
    vi.mocked(downloadModelsApi).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    await renderSection(statusOf(), onComplete)

    await user.click(screen.getByRole('button', { name: /다운로드/ }))

    expect(downloadModelsApi).toHaveBeenCalledWith({ whisperModelId: 'turbo-q5' })
    await emitProgress({
      key: 'whisper',
      receivedBytes: 287020597,
      totalBytes: TURBO_BYTES,
      percent: 50
    })
    expect(
      screen
        .getByRole('progressbar', { name: '음성 인식 모델 (기본 (권장)) 다운로드 진행률' })
        .getAttribute('aria-valuenow')
    ).toBe('50')

    await act(async () => {
      finish(readyStatus())
    })

    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(screen.getByText('모델이 준비되었습니다')).toBeTruthy()
  })

  it('설정에서는 이미 준비된 모델을 그대로 두면 버튼을 막고 사용 중임을 알린다', async () => {
    vi.mocked(getModelStatusApi).mockResolvedValue(readyStatus())

    await act(async () => {
      render(<ModelDownloadSection variant="setting" />)
    })
    await userEvent.click(screen.getByRole('button', { name: '모델 바꾸기' }))

    expect(screen.getByRole('button', { name: '이 모델 사용' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('현재 사용 중인 모델입니다')).toBeTruthy()
  })

  it('온보딩에서는 이미 준비된 모델도 이 모델 사용으로 다음 단계에 보낸다', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    await renderSection(readyStatus(), onComplete)

    await user.click(screen.getByRole('button', { name: '이 모델 사용' }))

    expect(downloadModelsApi).not.toHaveBeenCalled()
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('준비된 상태에서 다른 모델을 고르면 그 모델 용량만큼 받는다', async () => {
    const user = userEvent.setup()
    await renderSection(readyStatus())

    await user.click(screen.getByRole('radio', { name: /저사양/ }))

    expect(screen.getByRole('button', { name: '다운로드 (190MB)' })).toBeTruthy()
  })

  it('다운로드에 실패하면 한국어 안내를 보여준다', async () => {
    const user = userEvent.setup()
    vi.mocked(downloadModelsApi).mockRejectedValue(new Error('내려받은 파일이 손상되었습니다'))
    await renderSection(statusOf())

    await user.click(screen.getByRole('button', { name: /다운로드/ }))

    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('내려받은 파일이 손상되었습니다')).toBeTruthy()
  })

  it('모델 상태를 불러오지 못하면 오류와 다시 시도를 보여준다', async () => {
    vi.mocked(getModelStatusApi).mockRejectedValue(new Error('모델 상태를 확인하지 못했습니다'))

    await act(async () => {
      render(<ModelDownloadSection />)
    })

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeTruthy()
  })
})
