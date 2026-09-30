// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { latestProcessingItem } from './latestProcessingItem'

describe('Record processing selection', () => {
  it('selects the latest started processing item for Record tab resume', () => {
    expect(
      latestProcessingItem([
        {
          meetingId: 'older',
          title: '이전 회의',
          status: 'succeeded',
          stage: 'done',
          startedAt: '2026-09-28T10:00:00Z'
        },
        {
          meetingId: 'latest',
          title: '최근 회의',
          status: 'running',
          stage: 'syncing',
          startedAt: '2026-09-29T10:00:00Z'
        }
      ])?.meetingId
    ).toBe('latest')
  })
})
