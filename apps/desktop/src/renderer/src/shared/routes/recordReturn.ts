import type { PrototypeProcessingItem, PrototypeProcessingStage } from '@shared/prototype'
import { PATHS, processingPath } from './paths'

const RETURNABLE_STAGES = new Set<PrototypeProcessingStage>([
  'recording',
  'transcribing',
  'summarizing',
  'choosing',
  'publishing'
])

const STAGE_PRIORITY: Record<PrototypeProcessingStage, number> = {
  recording: 0,
  transcribing: 1,
  summarizing: 2,
  choosing: 3,
  publishing: 4,
  syncing: 5,
  done: 6,
  error: 7
}

export const NEW_RECORDING_PATH = `${PATHS.record}?new=1`

const startedAtTime = (item: PrototypeProcessingItem) => {
  if (!item.startedAt) return 0
  const time = Date.parse(item.startedAt)
  return Number.isFinite(time) ? time : 0
}

export const recordReturnPathFor = (items: PrototypeProcessingItem[]) => {
  const target = items
    .filter((item) => RETURNABLE_STAGES.has(item.stage))
    .sort((left, right) => {
      const time = startedAtTime(right) - startedAtTime(left)
      if (time !== 0) return time
      return STAGE_PRIORITY[left.stage] - STAGE_PRIORITY[right.stage]
    })[0]

  return target ? processingPath({ meetingId: target.meetingId }) : null
}
