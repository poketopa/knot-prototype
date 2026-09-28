import { describe, expect, it } from 'vitest'
import { applyStageProgress, toOverallPercent, type StagePercents } from './progress'

const accumulate = (events: { stage: 'stt' | 'diarize' | 'merge' | 'save'; percent: number }[]) =>
  events.reduce<StagePercents>((percents, event) => applyStageProgress({ percents, ...event }), {})

describe('applyStageProgress', () => {
  it('진행률이 낮은 이벤트가 뒤늦게 와도 되감지 않는다', () => {
    const percents = accumulate([
      { stage: 'stt', percent: 60 },
      { stage: 'stt', percent: 20 }
    ])

    expect(percents.stt).toBe(60)
  })

  it('merge가 시작되면 STT와 화자 분리는 끝난 것으로 본다', () => {
    const percents = applyStageProgress({
      percents: { stt: 40, diarize: 10 },
      stage: 'merge',
      percent: 0
    })

    expect(percents.stt).toBe(100)
    expect(percents.diarize).toBe(100)
  })

  it("'done'을 받으면 모든 단계를 100으로 채운다", () => {
    const percents = applyStageProgress({ percents: {}, stage: 'done', percent: 100 })

    expect(toOverallPercent({ percents })).toBe(100)
  })

  it("'error'는 진행률을 바꾸지 않는다", () => {
    const percents = applyStageProgress({ percents: { stt: 30 }, stage: 'error', percent: 0 })

    expect(percents).toEqual({ stt: 30 })
  })

  it('0~100 밖의 값은 잘라낸다', () => {
    expect(applyStageProgress({ percents: {}, stage: 'stt', percent: 140 }).stt).toBe(100)
    expect(applyStageProgress({ percents: {}, stage: 'stt', percent: -5 }).stt).toBe(0)
  })
})

describe('toOverallPercent', () => {
  it('아무 이벤트도 받지 않았으면 0이다', () => {
    expect(toOverallPercent({ percents: {} })).toBe(0)
  })

  it('화자 분리에 가장 큰 가중치를 준다', () => {
    expect(toOverallPercent({ percents: { stt: 100 } })).toBe(30)
    expect(toOverallPercent({ percents: { diarize: 100 } })).toBe(60)
  })

  it('저장까지 끝나면 100이 된다', () => {
    const percents = accumulate([
      { stage: 'stt', percent: 100 },
      { stage: 'diarize', percent: 100 },
      { stage: 'merge', percent: 100 },
      { stage: 'save', percent: 100 }
    ])

    expect(toOverallPercent({ percents })).toBe(100)
  })

  it('단계가 섞여 들어와도 단조 증가한다', () => {
    const steps = [
      { stage: 'stt' as const, percent: 50 },
      { stage: 'diarize' as const, percent: 10 },
      { stage: 'stt' as const, percent: 100 },
      { stage: 'diarize' as const, percent: 80 }
    ]

    const overalls = steps.reduce<{ percents: StagePercents; values: number[] }>(
      ({ percents, values }, step) => {
        const next = applyStageProgress({ percents, ...step })

        return { percents: next, values: [...values, toOverallPercent({ percents: next })] }
      },
      { percents: {}, values: [] }
    ).values

    expect(overalls).toEqual([...overalls].sort((a, b) => a - b))
  })
})
