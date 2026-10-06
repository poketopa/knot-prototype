import { describe, expect, it } from 'vitest'
import type { PrototypeProcessingItem } from '@shared/prototype'
import { NEW_RECORDING_PATH, recordReturnPathFor } from './recordReturn'

const item = (input: Partial<PrototypeProcessingItem> & { meetingId: string }) =>
  ({
    title: input.meetingId,
    status: 'pending',
    stage: 'choosing',
    ...input
  }) satisfies PrototypeProcessingItem

describe('record return target', () => {
  it('uses the explicit new recording path to bypass automatic return', () => {
    expect(NEW_RECORDING_PATH).toBe('/record?new=1')
  })

  it('returns the newest unfinished processing or selection screen', () => {
    expect(
      recordReturnPathFor([
        item({
          meetingId: 'older',
          stage: 'summarizing',
          startedAt: '2026-10-06T06:00:00Z'
        }),
        item({
          meetingId: 'newer',
          stage: 'choosing',
          startedAt: '2026-10-06T07:00:00Z'
        })
      ])
    ).toBe('/processing/newer')
  })

  it('does not let completed or storage-only states hijack the Record tab', () => {
    expect(
      recordReturnPathFor([
        item({ meetingId: 'done', stage: 'done', status: 'succeeded' }),
        item({ meetingId: 'syncing', stage: 'syncing', status: 'running' }),
        item({ meetingId: 'error', stage: 'error', status: 'failed' })
      ])
    ).toBeNull()
  })
})
