import { describe, expect, it } from 'vitest'
import {
  REQUIRED_MODEL_ASSETS,
  WHISPER_MODEL_OPTIONS,
  isWhisperModelId,
  modelAssetsOf,
  totalDownloadBytesOf,
  whisperFileNameOf
} from './desktop'

describe('desktop 모델 카탈로그', () => {
  it('고른 모델 하나와 필수 모델 전부를 내려받을 목록으로 만든다', () => {
    const assets = modelAssetsOf({ whisperModelId: 'small-q5_1' })

    expect(assets).toHaveLength(REQUIRED_MODEL_ASSETS.length + 1)
    expect(assets[0].fileName).toBe('ggml-small-q5_1.bin')
    expect(assets.filter((asset) => asset.key === 'whisper')).toHaveLength(1)
  })

  it('모르는 모델 id는 기본 모델로 되돌린다', () => {
    // 설정 파일이 손상돼 예전 id가 남아 있어도 앱이 떠야 한다
    expect(whisperFileNameOf('turbo-q5x' as never)).toBe('ggml-large-v3-turbo-q5_0.bin')
    expect(isWhisperModelId('turbo-q5x')).toBe(false)
    expect(isWhisperModelId('turbo-q5')).toBe(true)
  })

  it('총 다운로드 용량은 항목 크기의 합이다', () => {
    const assets = modelAssetsOf({ whisperModelId: 'turbo-q5' })
    const expected = assets.reduce((total, asset) => total + asset.downloadBytes, 0)

    expect(totalDownloadBytesOf({ assets })).toBe(expected)
  })

  it('모든 자산이 체크섬과 크기를 갖는다', () => {
    const all = [...WHISPER_MODEL_OPTIONS.map((option) => option.asset), ...REQUIRED_MODEL_ASSETS]

    all.forEach((asset) => {
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(asset.downloadBytes).toBeGreaterThan(0)
      expect(asset.url.startsWith('https://')).toBe(true)
    })
  })
})
