import { Link } from 'react-router'
import { prototypeBroadDocumentDomain, type PrototypeDocumentListItem } from '@shared/prototype'
import { documentDetailPath } from '@renderer/shared/routes/paths'
import styles from './index.module.css'

export type DocumentTreeItem = PrototypeDocumentListItem & {
  domain?: string
  recordingId?: string
  recordingStartedAt?: string
}

const DEFAULT_DOMAIN = '분류 없음'

export default function DocumentTree({
  documents,
  activeDocumentId
}: {
  documents: DocumentTreeItem[]
  activeDocumentId?: string
}) {
  const groups = documents.reduce<Map<string, DocumentTreeItem[]>>((map, doc) => {
    const domain = prototypeBroadDocumentDomain(doc) || DEFAULT_DOMAIN
    map.set(domain, [...(map.get(domain) ?? []), doc])
    return map
  }, new Map())

  return (
    <aside className={styles.sidebar} aria-label="문서">
      <header className={styles.header}>
        <p>
          <span className={styles.noteIcon} aria-hidden="true">
            노
          </span>
          내 노트
        </p>
        <h2 className={styles.title}>문서</h2>
      </header>
      {documents.length === 0 ? (
        <p className={styles.empty}>녹음을 마치면 도메인별 문서가 여기에 생깁니다.</p>
      ) : (
        <div className={styles.list}>
          {[...groups.entries()].map(([domain, items]) => (
            <details className={styles.domain} key={domain} open>
              <summary>
                <span className={styles.domainName}>{domain}</span>
                <span className={styles.count}>{items.length}</span>
              </summary>
              <div className={styles.items}>
                {items.map((doc) => (
                  <Link
                    className={styles.item}
                    key={doc.id}
                    to={documentDetailPath(doc.id)}
                    aria-current={activeDocumentId === doc.id ? 'page' : undefined}
                  >
                    {doc.title}
                  </Link>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </aside>
  )
}
