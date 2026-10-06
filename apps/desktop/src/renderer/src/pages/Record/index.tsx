import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router'
import type { PrototypeProcessingItem } from '@shared/prototype'
import RecorderSection from '@renderer/modules/widgets/recording/RecorderSection'
import { getProcessingApi, onPrototypeChanged } from '@renderer/shared/api/prototype'
import useRecordingState from '@renderer/shared/hooks/domain/recording/useRecordingState'
import { processingPath } from '@renderer/shared/routes/paths'
import { useRecordReturnPath } from '@renderer/shared/routes/useRecordReturnPath'
import styles from './index.module.css'

export default function Record() {
  const { search } = useLocation()
  const { isRecording } = useRecordingState()
  const isStartingNewRecording = new URLSearchParams(search).get('new') === '1'
  const recordReturnPath = useRecordReturnPath(isRecording || isStartingNewRecording)

  if (recordReturnPath) return <Navigate to={recordReturnPath} replace />

  return (
    <div className={styles.page}>
      <RecorderSection />
      <PendingSelectionLinks />
    </div>
  )
}

function PendingSelectionLinks() {
  const [items, setItems] = useState<PrototypeProcessingItem[]>([])

  useEffect(() => {
    let isMounted = true
    const refresh = async () => {
      try {
        const next = await getProcessingApi()
        if (isMounted) {
          setItems(
            next
              .filter((item) => item.stage === 'choosing')
              .sort((left, right) => {
                const rightTime = Date.parse(right.startedAt ?? '')
                const leftTime = Date.parse(left.startedAt ?? '')
                return (
                  (Number.isFinite(rightTime) ? rightTime : 0) -
                  (Number.isFinite(leftTime) ? leftTime : 0)
                )
              })
          )
        }
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
    <section className={styles.pending} aria-label="선택 대기 중인 정리">
      <h2>선택을 기다리는 정리</h2>
      <div className={styles.pendingList}>
        {items.map((item) => (
          <Link key={item.meetingId} to={processingPath({ meetingId: item.meetingId })}>
            {item.title}
          </Link>
        ))}
      </div>
    </section>
  )
}
