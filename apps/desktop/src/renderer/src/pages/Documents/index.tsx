import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { PrototypeDocumentListItem, PrototypeProcessingItem } from '@shared/prototype'
import {
  getDocumentsApi,
  getProcessingApi,
  onPrototypeChanged
} from '@renderer/shared/api/prototype'
import { documentDetailPath, meetingDetailPath } from '@renderer/shared/routes/paths'
import styles from './index.module.css'

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })

export default function Documents() {
  const [documents, setDocuments] = useState<PrototypeDocumentListItem[]>([])
  const [processing, setProcessing] = useState<PrototypeProcessingItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  useEffect(() => {
    let isMounted = true
    const refresh = async () => {
      try {
        const [docs, jobs] = await Promise.all([getDocumentsApi(), getProcessingApi()])
        if (isMounted) {
          setDocuments(docs)
          setProcessing(jobs)
          setError(null)
        }
      } catch (caught) {
        if (isMounted) setError(caught instanceof Error ? caught.message : String(caught))
      } finally {
        if (isMounted) setIsLoading(false)
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
  const pending = processing.filter((item) => item.stage !== 'done' || !item.saved)
  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <div>
          <h1>문서</h1>
          <p>회의에서 나눈 결정을 주제별로 모아둬요.</p>
        </div>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {pending.length > 0 && (
        <section className={styles.pending} aria-label="처리 중인 녹음">
          <h2>
            처리 중인 녹음 <span>{pending.length}</span>
          </h2>
          {pending.map((item) => (
            <Link
              className={styles.job}
              key={item.meetingId}
              to={meetingDetailPath({ meetingId: item.meetingId })}
            >
              <span>{item.title}</span>
              <small>
                {item.error
                  ? '확인이 필요해요'
                  : item.stage === 'recording'
                    ? '녹음 중'
                    : item.stage === 'syncing'
                      ? '서버 저장 대기'
                      : '정리 중'}{' '}
                →
              </small>
            </Link>
          ))}
        </section>
      )}
      <h2 className={styles.label}>
        내 문서 <span>{documents.length}</span>
      </h2>
      {isLoading ? (
        <p role="status" className={styles.empty}>
          문서를 불러오고 있어요.
        </p>
      ) : documents.length === 0 ? (
        <section className={styles.empty}>
          <div className={styles.emptyIcon} aria-hidden="true">
            ≡
          </div>
          <h2>첫 번째 결정을 남겨보세요</h2>
          <p>
            녹음을 끝내면 전사와 AI 정리가 이어지고,
            <br />
            확정된 결정과 미결정 사항이 주제별 문서에 쌓여요.
          </p>
        </section>
      ) : (
        <div className={styles.list}>
          {documents.map((doc) => (
            <Link key={doc.id} className={styles.row} to={documentDetailPath(doc.id)}>
              <div className={styles.description}>
                <h2>{doc.title}</h2>
                {doc.overview && <p>{doc.overview}</p>}
              </div>
              <div className={styles.metadata}>
                <time dateTime={doc.updatedAt}>{formatDate(doc.updatedAt)}</time>
                <span className={styles.badge}>{doc.latestVersion}회 기록</span>
                <span className={styles.chevron} aria-hidden="true">
                  ›
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
