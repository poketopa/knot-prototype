import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { PrototypeProcessingItem } from '@shared/prototype'
import { getProcessingApi, onPrototypeChanged } from '@renderer/shared/api/prototype'
import RecorderSection from '@renderer/modules/widgets/recording/RecorderSection'
import { ProcessingContent } from '@renderer/pages/Processing'
import { latestProcessingItem } from './latestProcessingItem'

type ProcessingItemV2 = PrototypeProcessingItem & {
  startedAt?: string
  recordingStartedAt?: string
}

export default function Record() {
  const [params, setParams] = useSearchParams()
  const [latest, setLatest] = useState<ProcessingItemV2 | null>(null)
  const isNewRecording = params.get('new') === '1'

  useEffect(() => {
    let isMounted = true
    const refresh = async () => {
      try {
        const jobs = (await getProcessingApi()) as ProcessingItemV2[]
        if (isMounted) setLatest(latestProcessingItem(jobs))
      } catch {
        if (isMounted) setLatest(null)
      }
    }
    void refresh()
    const unsubscribe = onPrototypeChanged(({ reason }) => {
      if (reason === 'processing' || reason === 'recording' || reason === 'documents') {
        void refresh()
      }
    })
    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [])

  if (latest && !isNewRecording) {
    return (
      <ProcessingContent
        key={latest.meetingId}
        meetingId={latest.meetingId}
        onNewRecording={() => setParams({ new: '1' })}
      />
    )
  }

  return <RecorderSection />
}
