import { describe, expect, it } from 'vitest'

import { applyProgress, completedSteps, initialSteps, overallPercent } from './jobProgress'

describe('applyProgress', () => {
  it('받기 이벤트는 단계를 downloading으로 두고 진행률은 최고값을 유지한다', () => {
    const first = applyProgress({
      steps: initialSteps(),
      progress: { stage: 'diarize', kind: 'download', percent: 80, note: '분할 내려받는 중' }
    })
    const second = applyProgress({
      steps: first,
      progress: { stage: 'diarize', kind: 'download', percent: 10, note: '임베딩 내려받는 중' }
    })

    expect(second.diarize).toEqual({
      status: 'downloading',
      percent: 80,
      note: '임베딩 내려받는 중'
    })
    expect(second.stt.status).toBe('waiting')
  })

  it('뒤 단계가 시작되면 앞 단계는 끝난 것으로 표시한다', () => {
    const steps = applyProgress({
      steps: initialSteps(),
      progress: { stage: 'stt', kind: 'run', percent: 25, note: '전사 중' }
    })

    expect(steps.diarize.status).toBe('done')
    expect(steps.stt).toEqual({ status: 'running', percent: 25, note: '전사 중' })
    expect(steps.merge.status).toBe('waiting')
  })

  it('decode 단계는 화면 단계가 아니라 무시한다', () => {
    const steps = initialSteps()

    expect(
      applyProgress({
        steps,
        progress: { stage: 'decode', kind: 'run', percent: 50, note: '' }
      })
    ).toBe(steps)
  })
})

describe('overallPercent', () => {
  it('모두 끝나면 100이다', () => {
    expect(overallPercent({ steps: completedSteps(), isDownloadExpected: true })).toBe(100)
  })

  it('받기가 없을 때 음성 인식 절반은 화자 구분 30 + 음성 인식 30이다', () => {
    const steps = applyProgress({
      steps: initialSteps(),
      progress: { stage: 'stt', kind: 'run', percent: 50, note: '' }
    })

    expect(overallPercent({ steps, isDownloadExpected: false })).toBe(60)
  })

  it('받기가 예상되면 받기 구간이 단계 몫의 40%를 차지한다', () => {
    const steps = applyProgress({
      steps: initialSteps(),
      progress: { stage: 'stt', kind: 'download', percent: 50, note: '' }
    })

    // 화자 구분 30 + 음성 인식 60 × 0.4 × 0.5 = 42
    expect(overallPercent({ steps, isDownloadExpected: true })).toBe(42)
  })
})
