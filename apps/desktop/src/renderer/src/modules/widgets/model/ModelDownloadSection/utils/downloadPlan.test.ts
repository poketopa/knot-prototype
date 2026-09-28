import { describe, expect, it } from 'vitest'
import type { ModelStatusResponse } from '@shared/ipc'
import { planDownload } from './downloadPlan'

const statusOf = (overrides: Partial<ModelStatusResponse> = {}): ModelStatusResponse => ({
  isReady: false,
  isSummaryReady: false,
  selectedWhisperModelId: 'turbo-q5',
  recommendedWhisperModelId: 'turbo-q5',
  whisperOptions: [
    { id: 'turbo-q5', label: '기본 (권장)', description: '', sizeBytes: 500 },
    { id: 'small-q5_1', label: '저사양', description: '', sizeBytes: 100 }
  ],
  items: [
    {
      key: 'whisper',
      label: '음성 인식 모델',
      sizeBytes: 500,
      isInstalled: false,
      isRequired: true
    },
    { key: 'vad', label: '무음 감지 모델', sizeBytes: 10, isInstalled: true, isRequired: true },
    { key: 'summary', label: '요약 모델', sizeBytes: 2000, isInstalled: false, isRequired: false }
  ],
  ...overrides
})

describe('planDownload', () => {
  it('요약 모델은 빼고 설치되지 않은 필수 모델 용량만 더한다', () => {
    const { items, bytesToDownload } = planDownload({ status: statusOf(), selectedId: 'turbo-q5' })

    expect(items.map((item) => item.key)).toEqual(['whisper', 'vad'])
    expect(bytesToDownload).toBe(500)
  })

  it('다른 음성 인식 모델을 고르면 그 모델 용량으로 바꾸고 설치되지 않은 것으로 본다', () => {
    const status = statusOf({
      isReady: true,
      items: [
        {
          key: 'whisper',
          label: '음성 인식 모델',
          sizeBytes: 500,
          isInstalled: true,
          isRequired: true
        },
        { key: 'vad', label: '무음 감지 모델', sizeBytes: 10, isInstalled: true, isRequired: true }
      ]
    })

    const { items, bytesToDownload } = planDownload({ status, selectedId: 'small-q5_1' })

    expect(items[0].label).toBe('음성 인식 모델 (저사양)')
    expect(items[0].isInstalled).toBe(false)
    expect(bytesToDownload).toBe(100)
  })

  it('전부 설치돼 있으면 받을 용량이 0이다', () => {
    const status = statusOf({
      isReady: true,
      items: [
        {
          key: 'whisper',
          label: '음성 인식 모델',
          sizeBytes: 500,
          isInstalled: true,
          isRequired: true
        },
        { key: 'vad', label: '무음 감지 모델', sizeBytes: 10, isInstalled: true, isRequired: true }
      ]
    })

    expect(planDownload({ status, selectedId: 'turbo-q5' }).bytesToDownload).toBe(0)
  })
})
