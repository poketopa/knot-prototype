import type { TopicAnalysisResult, TopicAnalysisResultV2 } from '@shared/types'

const normalized = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()

/** 입력 한도가 부족할 때 이미 검증한 내용을 삭제하지 않고 같은 제목의 주제만 연결한다. */
export const mergeTopicPartials = (partials: TopicAnalysisResult[]): TopicAnalysisResultV2 => {
  const topics = new Map<string, TopicAnalysisResultV2['topics'][number]>()
  for (const partial of partials) {
    if (partial.schemaVersion !== 2) throw new Error('이전 분석 형식은 안전하게 연결할 수 없습니다')
    for (const topic of partial.topics) {
      const key = JSON.stringify([normalized(topic.domain), normalized(topic.title)])
      const previous = topics.get(key)
      if (!previous) {
        topics.set(key, structuredClone(topic))
        continue
      }
      for (const section of topic.summarySections) {
        const existing = previous.summarySections.find(
          (item) =>
            normalized(item.heading) === normalized(section.heading) && item.text === section.text
        )
        if (existing) {
          existing.sourceUtteranceIds = [
            ...new Set([...existing.sourceUtteranceIds, ...section.sourceUtteranceIds])
          ]
        } else previous.summarySections.push(structuredClone(section))
      }
      for (const section of topic.outline) {
        let existing = previous.outline.find(
          (item) => normalized(item.heading) === normalized(section.heading)
        )
        if (!existing) {
          existing = { heading: section.heading, items: [] }
          previous.outline.push(existing)
        }
        for (const item of section.items) {
          const duplicate = existing.items.find((candidate) => candidate.text === item.text)
          if (duplicate)
            duplicate.sourceUtteranceIds = [
              ...new Set([...duplicate.sourceUtteranceIds, ...item.sourceUtteranceIds])
            ]
          else existing.items.push(structuredClone(item))
        }
      }
    }
  }
  return { schemaVersion: 2, topics: [...topics.values()] }
}
