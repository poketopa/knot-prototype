import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import type { PrototypeMeetingSummary } from '@shared/prototype'
import { onMeetingsChanged } from '@renderer/shared/api/events'
import {
  getSummariesApi,
  onPrototypeChanged,
  regenerateSummaryApi
} from '@renderer/shared/api/prototype'
import TranscriptPanel from '@renderer/modules/widgets/prototype/TranscriptPanel'
import { meetingDetailPath, PATHS, summaryDetailPath } from '@renderer/shared/routes/paths'
import styles from './index.module.css'

const formatDate = (date: string) =>
  new Date(date).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })

const statusText = (summary: PrototypeMeetingSummary) => {
  if (summary.status === 'recording') return '녹음 중'
  if (summary.status === 'processing') return '정리 중'
  if (summary.status === 'failed') return '정리 실패'
  if (summary.status === 'empty') return '정리할 내용 없음'
  return '정리 완료'
}

export default function Summaries() {
  const { recordingId } = useParams<{ recordingId: string }>()
  const [items, setItems] = useState<PrototypeMeetingSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showTranscript, setShowTranscript] = useState(false)
  const [refreshRequestError, setRefreshRequestError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const result = await getSummariesApi()
        if (!active) return
        setItems(result)
        setError(null)
      } catch {
        if (active) setError('회의 정리를 불러오지 못했어요. 다시 시도해 주세요.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void refresh()
    const offMeetings = onMeetingsChanged(() => void refresh())
    const offPrototype = onPrototypeChanged(({ reason }) => {
      if (reason !== 'event') void refresh()
    })
    return () => {
      active = false
      offMeetings()
      offPrototype()
    }
  }, [reload])

  const selected = items.find((item) => item.recordingId === recordingId)
  if (recordingId) {
    return (
      <section className={styles.section} aria-labelledby="summary-title">
        <Link className={styles.back} to={PATHS.summaries}>
          ‹ 정리 목록
        </Link>
        {loading ? (
          <p role="status">회의 정리를 불러오고 있어요.</p>
        ) : error ? (
          <p role="alert">{error}</p>
        ) : !selected ? (
          <p>이 녹음의 정리를 찾을 수 없습니다.</p>
        ) : (
          <article className={styles.detail}>
            <p className={styles.eyebrow}>회의 정리</p>
            <h1 id="summary-title">{selected.title}</h1>
            <p className={styles.meta}>
              {formatDate(selected.startedAt)} · {statusText(selected)}
            </p>
            {selected.status === 'ready' ? (
              <>
                <div className={styles.highlight}>
                  <h2>핵심 요약</h2>
                  <p>{selected.headline}</p>
                </div>
                <h2>회의 전체 정리</h2>
                <p className={styles.body}>{selected.body}</p>
                {selected.hasTranscript && (
                  <div className={styles.refresh}>
                    <button
                      type="button"
                      disabled={Boolean(selected.refreshStatus)}
                      onClick={async () => {
                        setRefreshRequestError(null)
                        try {
                          await regenerateSummaryApi(selected.recordingId)
                        } catch (caught) {
                          setRefreshRequestError(
                            caught instanceof Error ? caught.message : '다시 정리하지 못했어요.'
                          )
                        }
                      }}
                    >
                      {selected.refreshStatus ? '다시 정리하는 중' : '전사에서 다시 정리하기'}
                    </button>
                    {selected.refreshStatus && (
                      <p role="status">기존 정리본은 그대로 보관됩니다.</p>
                    )}
                    {(selected.refreshError || refreshRequestError) && (
                      <p role="alert">{selected.refreshError ?? refreshRequestError}</p>
                    )}
                  </div>
                )}
              </>
            ) : selected.status === 'empty' ? (
              <p className={styles.message}>정리할 내용이 없습니다.</p>
            ) : selected.status === 'failed' ? (
              <div className={styles.message} role="alert">
                <p>{selected.error ?? '정리를 완료하지 못했어요.'}</p>
                <Link to={meetingDetailPath({ meetingId: selected.recordingId })}>
                  녹음 이력에서 다시 시도
                </Link>
              </div>
            ) : (
              <p className={styles.message}>
                {statusText(selected)}입니다. 완료되면 여기에 표시됩니다.
              </p>
            )}
            {selected.hasTranscript && (
              <div className={styles.transcript}>
                <button type="button" onClick={() => setShowTranscript((value) => !value)}>
                  {showTranscript ? '전사 원문 닫기' : '전사 원문 보기'}
                </button>
                {showTranscript && (
                  <TranscriptPanel
                    recordingId={selected.recordingId}
                    onClose={() => setShowTranscript(false)}
                  />
                )}
              </div>
            )}
          </article>
        )}
      </section>
    )
  }

  return (
    <section className={styles.section} aria-labelledby="summary-list-title">
      <div className={styles.heading}>
        <div>
          <h1 id="summary-list-title">정리</h1>
          <p>녹음한 회의마다 핵심 요약과 전체 정리를 확인해요.</p>
        </div>
        <Link className={styles.primary} to={PATHS.record}>
          녹음 시작
        </Link>
      </div>
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            onClick={() => {
              setLoading(true)
              setReload((value) => value + 1)
            }}
          >
            다시 불러오기
          </button>
        </div>
      )}
      {loading && <p role="status">회의 정리를 불러오고 있어요.</p>}
      {!loading && !error && items.length === 0 && (
        <p className={styles.message}>아직 녹음한 회의가 없습니다.</p>
      )}
      {items.length > 0 && (
        <ul className={styles.list} aria-label="회의 정리 목록">
          {items.map((item) => (
            <li key={item.recordingId}>
              <Link to={summaryDetailPath(item.recordingId)}>
                <span>
                  <strong>{item.title}</strong>
                  <small>{formatDate(item.startedAt)}</small>
                </span>
                <span className={styles.state}>{statusText(item)} →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
