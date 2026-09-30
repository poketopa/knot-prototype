import type { PrototypeProcessingItem } from '@shared/prototype'

export const latestProcessingItem = (items: PrototypeProcessingItem[]) =>
  [...items].sort((a, b) => {
    const timestamp = (item: PrototypeProcessingItem) => {
      const time = item.startedAt ? Date.parse(item.startedAt) : 0
      return Number.isFinite(time) ? time : 0
    }
    return timestamp(b) - timestamp(a)
  })[0] ?? null
