import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { Meeting } from '@shared/types'
import type { PrototypeProcessingItem } from '@shared/prototype'
import { getMeetingsApi } from '@renderer/shared/api/meetings'
import { onMeetingsChanged } from '@renderer/shared/api/events'
import { getProcessingApi, onPrototypeChanged } from '@renderer/shared/api/prototype'
import { PATHS } from '@renderer/shared/routes/paths'

import RecordingRow from './ui/RecordingRow'
import styles from './index.module.css'

export default function RecordingHistorySection() {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [jobs, setJobs] = useState<PrototypeProcessingItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let isMounted = true
    let requestId = 0
    const refresh = async () => {
      const currentRequest = ++requestId
      try {
        const [nextMeetings, nextJobs] = await Promise.all([getMeetingsApi(), getProcessingApi()])
        if (!isMounted || currentRequest !== requestId) return
        setMeetings([...nextMeetings].sort((a, b) => b.createdAt - a.createdAt))
        setJobs(nextJobs)
        setError(null)
      } catch {
        if (isMounted && currentRequest === requestId)
          setError('녹음 이력을 불러오지 못했어요. 다시 시도해 주세요.')
      } finally {
        if (isMounted && currentRequest === requestId) setIsLoading(false)
      }
    }
    void refresh()
    const unsubscribeMeetings = onMeetingsChanged(() => void refresh())
    const unsubscribePrototype = onPrototypeChanged(({ reason }) => {
      if (reason !== 'event') void refresh()
    })
    return () => {
      isMounted = false
      unsubscribeMeetings()
      unsubscribePrototype()
    }
  }, [reload])

  const handleReload = () => {
    setIsLoading(true)
    setError(null)
    setReload((value) => value + 1)
  }
  const jobsById = new Map(jobs.map((job) => [job.meetingId, job]))

  return (
    <section className={styles.section} aria-labelledby="recording-history-title">
      <header className={styles.heading}>
        <div>
          <h1 id="recording-history-title">녹음 이력</h1>
          <p>이 기기에 보관된 녹음과 전사, 주제별 문서를 다시 확인해요.</p>
        </div>
        <Link className={styles.primary} to={PATHS.record}>
          녹음 시작
        </Link>
      </header>
      {error && (
        <div className={styles.error} role="alert">
          <p>{error}</p>
          <button onClick={handleReload}>다시 불러오기</button>
        </div>
      )}
      {isLoading && <p role="status">녹음 이력을 불러오고 있어요.</p>}
      {!isLoading && !error && meetings.length === 0 && (
        <div className={styles.empty}>
          <h2>아직 녹음한 회의가 없어요</h2>
          <p>녹음을 시작하면 이곳에 기록이 쌓여요.</p>
        </div>
      )}
      {meetings.length > 0 && (
        <>
          <p className={styles.count}>전체 {meetings.length}건 · 최신순</p>
          <ul className={styles.list} aria-label="녹음 목록">
            {meetings.map((meeting) => (
              <RecordingRow key={meeting.id} meeting={meeting} job={jobsById.get(meeting.id)} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
