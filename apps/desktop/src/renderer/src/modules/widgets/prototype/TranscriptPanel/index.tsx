import { useCallback, useEffect, useRef, useState } from 'react'
import type { PrototypeTranscript } from '@shared/prototype'
import { getTranscriptApi, trackApi } from '@renderer/shared/api/prototype'
import { formatClock } from '@renderer/shared/utils/formatClock'
import styles from './index.module.css'

interface TranscriptPanelProps {
  recordingId: string
  onClose?: () => void
}

const missingTranscriptMessage =
  '전사 원문을 찾을 수 없습니다. 이 기기에 아직 원문이 없거나 동기화가 필요합니다.'

const toFriendlyMessage = (caught: unknown) => {
  const message = caught instanceof Error ? caught.message : String(caught)
  return message.replace(/^Error:\s*/i, '') || '원문을 불러오지 못했어요. 다시 시도해 주세요.'
}

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })

const getDurationSec = (transcript: PrototypeTranscript) =>
  typeof transcript.durationSec === 'number' && Number.isFinite(transcript.durationSec)
    ? transcript.durationSec
    : null

const formatDuration = (durationSec: number) => {
  const totalSeconds = Math.round(durationSec)
  if (totalSeconds < 60) return `${totalSeconds}초`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds === 0 ? `${minutes}분` : `${minutes}분 ${seconds}초`
}

export default function TranscriptPanel({ recordingId, onClose }: TranscriptPanelProps) {
  const [transcript, setTranscript] = useState<PrototypeTranscript | null>(null)
  const [error, setError] = useState<{ recordingId: string; message: string } | null>(null)
  const requestIdRef = useRef(0)

  const retryTranscript = useCallback(async () => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setError(null)

    try {
      const data = await getTranscriptApi(recordingId)
      if (requestIdRef.current !== requestId) return
      if (!data) throw new Error(missingTranscriptMessage)
      setTranscript(data)
      void trackApi({ eventType: 'transcript_viewed', recordingId }).catch(() => {})
    } catch (caught: unknown) {
      if (requestIdRef.current !== requestId) return
      setTranscript(null)
      setError({ recordingId, message: toFriendlyMessage(caught) })
    }
  }, [recordingId])

  useEffect(() => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    void getTranscriptApi(recordingId)
      .then((data) => {
        if (requestIdRef.current !== requestId) return
        if (!data) {
          setTranscript(null)
          setError({ recordingId, message: missingTranscriptMessage })
          return
        }
        setTranscript(data)
        setError(null)
        void trackApi({ eventType: 'transcript_viewed', recordingId }).catch(() => {})
      })
      .catch((caught: unknown) => {
        if (requestIdRef.current !== requestId) return
        setTranscript(null)
        setError({ recordingId, message: toFriendlyMessage(caught) })
      })

    return () => {
      requestIdRef.current += 1
    }
  }, [recordingId])

  const currentTranscript = transcript?.recordingId === recordingId ? transcript : null
  const currentError = error?.recordingId === recordingId ? error.message : null
  const labels = [...new Set(currentTranscript?.utterances.map((item) => item.speakerLabel) ?? [])]
  const durationSec = currentTranscript ? getDurationSec(currentTranscript) : null

  return (
    <aside className={styles.panel} aria-label="전사 원문">
      <header>
        <h2>원문</h2>
        {onClose && (
          <button
            type="button"
            className={styles.closeButton}
            aria-label="원문 닫기"
            onClick={onClose}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
              <path
                d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="1.8"
              />
            </svg>
          </button>
        )}
      </header>
      {currentError ? (
        <div role="alert" className={styles.error}>
          <p>{currentError}</p>
          <button
            type="button"
            onClick={() => {
              void retryTranscript()
            }}
          >
            다시 불러오기
          </button>
        </div>
      ) : !currentTranscript ? (
        <p role="status" className={styles.status}>
          원문을 불러오고 있어요.
        </p>
      ) : (
        <>
          <div className={styles.meta}>
            <span>{formatDate(currentTranscript.startedAt)} 녹음</span>
            {durationSec !== null && <strong>{formatDuration(durationSec)}</strong>}
          </div>
          <div className={styles.utterances}>
            {currentTranscript.utterances.length === 0 && (
              <p className={styles.empty}>기록된 발화가 없습니다.</p>
            )}
            {currentTranscript.utterances.map((item) => (
              <div className={styles.utterance} key={item.id}>
                <time>{formatClock({ sec: item.startSec })}</time>
                <p>
                  <span>참여자 {labels.indexOf(item.speakerLabel) + 1}:</span> {item.text}
                </p>
              </div>
            ))}
          </div>
          <p className={styles.caption}>
            이 문서를 만든 원본이에요. 전사 전체를 그대로 볼 수 있어요.
          </p>
        </>
      )}
    </aside>
  )
}
