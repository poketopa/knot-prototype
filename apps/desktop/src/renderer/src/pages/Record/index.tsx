import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { PrototypeProcessingItem } from '@shared/prototype'
import RecorderSection from '@renderer/modules/widgets/recording/RecorderSection'
import { getProcessingApi, onPrototypeChanged } from '@renderer/shared/api/prototype'
import { processingPath } from '@renderer/shared/routes/paths'

export default function Record() {
  return (
    <>
      <RecorderSection />
      <PendingSelectionLinks />
    </>
  )
}

function PendingSelectionLinks() {
  const [items, setItems] = useState<PrototypeProcessingItem[]>([])

  useEffect(() => {
    let isMounted = true
    const refresh = async () => {
      try {
        const next = await getProcessingApi()
        if (isMounted) setItems(next.filter((item) => item.stage === 'choosing'))
      } catch {
        if (isMounted) setItems([])
      }
    }
    void refresh()
    const unsubscribe = onPrototypeChanged(({ reason }) => {
      if (reason !== 'event') void refresh()
    })
    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [])

  if (items.length === 0) return null

  return (
    <section aria-label="선택 대기 중인 정리">
      <h2>선택을 기다리는 정리</h2>
      {items.map((item) => (
        <Link key={item.meetingId} to={processingPath({ meetingId: item.meetingId })}>
          {item.title}
        </Link>
      ))}
    </section>
  )
}
