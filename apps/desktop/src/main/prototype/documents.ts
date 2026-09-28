import type {
  PrototypeDocumentContribution,
  PrototypeDocumentDetail,
  PrototypeDocumentListItem
} from '@shared/prototype'
import { getDb } from '../db/connection'
import { requirePrototypeUser } from './authState'
import { PrototypeApiError, prototypeRequest } from './apiClient'

interface DocumentRow {
  id: string
  title: string
  latest_version: number
  body: string
  contributions: string
  overview: string | null
  updated_at: string
}

interface RemoteDocumentListItem {
  id: string
  title: string
  latestVersion: number
  updatedAt: string
  overview?: string
}

interface RemoteDocumentDetail {
  id: string
  title: string
  latestVersion: number
  body: {
    sections: Array<
      PrototypeDocumentContribution['section'] & {
        recordingStartedAt?: string
        recordingId: string
      }
    >
  }
  snapshotId: string
  overview?: string
  updatedAt: string
}

const remoteContributions = ({ document }: { document: RemoteDocumentDetail }) =>
  document.body.sections.map((section): PrototypeDocumentContribution => ({
    recordingId: section.recordingId,
    startedAt: section.recordingStartedAt ?? document.updatedAt,
    section: {
      overview: section.overview,
      decisions: section.decisions,
      unresolved: section.unresolved
    }
  }))

const latestContributionOverview = (contributions: PrototypeDocumentContribution[]) => {
  const latest = contributions.reduce<PrototypeDocumentContribution | null>(
    (selected, candidate) => {
      if (!selected) return candidate
      return candidate.startedAt >= selected.startedAt ? candidate : selected
    },
    null
  )
  const overview = latest?.section.overview.trim()
  return overview ? overview : null
}

const overviewFromRow = (row: DocumentRow | undefined) => {
  if (!row) return null
  if (row.overview) return row.overview
  try {
    return latestContributionOverview(
      JSON.parse(row.contributions) as PrototypeDocumentContribution[]
    )
  } catch {
    return null
  }
}

const remoteOverview = ({ document }: { document: RemoteDocumentDetail }) =>
  document.overview ?? latestContributionOverview(remoteContributions({ document }))

const renderBody = ({ document }: { document: RemoteDocumentDetail }) =>
  `# ${document.title}\n\n` +
  remoteContributions({ document })
    .map((contribution) => {
      const decisions = contribution.section.decisions.length
        ? contribution.section.decisions.map((item) => `- ${item.text}`).join('\n')
        : '- 없음'
      const unresolved = contribution.section.unresolved.length
        ? contribution.section.unresolved.map((item) => `- ${item.text}`).join('\n')
        : '- 없음'

      return [
        `## ${contribution.startedAt}`,
        '',
        contribution.section.overview,
        '',
        '### 확정된 결정',
        decisions,
        '',
        '### 미결정 사항',
        unresolved
      ].join('\n')
    })
    .join('\n\n')

const toListItem = (row: DocumentRow): PrototypeDocumentListItem => ({
  id: row.id,
  title: row.title,
  latestVersion: row.latest_version,
  updatedAt: row.updated_at,
  ...(row.overview ? { overview: row.overview } : {})
})

const toDetail = (row: DocumentRow): PrototypeDocumentDetail => ({
  id: row.id,
  title: row.title,
  version: row.latest_version,
  body: row.body,
  contributions: JSON.parse(row.contributions) as PrototypeDocumentContribution[]
})

const cacheDocument = ({ document }: { document: RemoteDocumentDetail }) => {
  const owner = requirePrototypeUser()

  getDb()
    .prepare(
      `INSERT INTO prototype_documents (
         id, owner_id, title, latest_version, body, contributions, overview, updated_at
       )
       VALUES (@id, @ownerId, @title, @latestVersion, @body, @contributions, @overview, @updatedAt)
       ON CONFLICT(owner_id, id) DO UPDATE SET
         title = excluded.title,
         latest_version = excluded.latest_version,
         body = excluded.body,
         contributions = excluded.contributions,
         overview = excluded.overview,
         updated_at = excluded.updated_at`
    )
    .run({
      id: document.id,
      ownerId: owner.id,
      title: document.title,
      latestVersion: document.latestVersion,
      body: renderBody({ document }),
      contributions: JSON.stringify(remoteContributions({ document })),
      overview: remoteOverview({ document }),
      updatedAt: document.updatedAt
    })
}

export const listPrototypeDocuments = async () => {
  const owner = requirePrototypeUser()
  try {
    const remote = await prototypeRequest<{ documents: RemoteDocumentListItem[] }>({
      path: '/documents'
    })
    if (requirePrototypeUser().id !== owner.id) throw new Error('계정이 변경되었습니다')

    const cachedRows = (
      getDb()
        .prepare(
          `SELECT id, title, latest_version, body, contributions, overview, updated_at
           FROM prototype_documents
           WHERE owner_id = @ownerId`
        )
        .all({ ownerId: owner.id }) as DocumentRow[]
    ).reduce<Map<string, DocumentRow>>((rows, row) => rows.set(row.id, row), new Map())

    const items = remote.documents.map((item): PrototypeDocumentListItem => {
      const cached = cachedRows.get(item.id)
      const overview =
        item.overview ??
        (cached?.latest_version === item.latestVersion ? overviewFromRow(cached) : null) ??
        undefined
      return {
        id: item.id,
        title: item.title,
        latestVersion: item.latestVersion,
        updatedAt: item.updatedAt,
        ...(overview ? { overview } : {})
      }
    })

    const cache = getDb().prepare(`INSERT INTO prototype_documents
      (id, owner_id, title, latest_version, body, contributions, overview, updated_at)
      VALUES (@id, @ownerId, @title, @version, '', '[]', @overview, @updatedAt)
      ON CONFLICT(owner_id,id) DO UPDATE SET title=excluded.title,
      latest_version=excluded.latest_version, overview=excluded.overview, updated_at=excluded.updated_at
      WHERE prototype_documents.body = '' OR prototype_documents.latest_version = excluded.latest_version`)
    getDb().transaction(() => {
      for (const item of items)
        cache.run({
          id: item.id,
          ownerId: owner.id,
          title: item.title,
          version: item.latestVersion,
          overview: item.overview ?? null,
          updatedAt: item.updatedAt
        })
    })()

    for (const item of items) {
      if (item.overview) continue
      try {
        const detail = await prototypeRequest<RemoteDocumentDetail>({
          path: `/documents/${item.id}`
        })
        if (requirePrototypeUser().id !== owner.id) throw new Error('계정이 변경되었습니다')
        cacheDocument({ document: detail })
        const overview = remoteOverview({ document: detail })
        if (overview) item.overview = overview
      } catch (caught) {
        if (requirePrototypeUser().id !== owner.id) throw new Error('계정이 변경되었습니다')
        if (caught instanceof PrototypeApiError && caught.status === 404) continue
      }
    }

    return items
  } catch (caught) {
    if (requirePrototypeUser().id !== owner.id) throw new Error('계정이 변경되었습니다')
    if (caught instanceof PrototypeApiError && caught.status === 404) throw caught
    return (
      getDb()
        .prepare(
          `SELECT id, title, latest_version, body, contributions, overview, updated_at
           FROM prototype_documents
           WHERE owner_id = @ownerId
           ORDER BY updated_at DESC`
        )
        .all({ ownerId: owner.id }) as DocumentRow[]
    ).map(toListItem)
  }
}

export const getPrototypeDocument = async ({ documentId }: { documentId: string }) => {
  const owner = requirePrototypeUser()
  try {
    const remote = await prototypeRequest<RemoteDocumentDetail>({
      path: `/documents/${documentId}`
    })
    if (requirePrototypeUser().id !== owner.id) throw new Error('계정이 변경되었습니다')
    cacheDocument({ document: remote })

    return toDetail({
      id: remote.id,
      title: remote.title,
      latest_version: remote.latestVersion,
      body: renderBody({ document: remote }),
      contributions: JSON.stringify(remoteContributions({ document: remote })),
      overview: remoteOverview({ document: remote }),
      updated_at: remote.updatedAt
    })
  } catch (caught) {
    if (requirePrototypeUser().id !== owner.id) throw new Error('계정이 변경되었습니다')
    if (caught instanceof PrototypeApiError && caught.status === 404) return null
    const row = getDb()
      .prepare(
        `SELECT id, title, latest_version, body, contributions, overview, updated_at
         FROM prototype_documents
         WHERE owner_id = @ownerId AND id = @documentId`
      )
      .get({ ownerId: owner.id, documentId }) as DocumentRow | undefined

    if (row && !row.body)
      throw new Error(
        '이 문서는 아직 이 Mac에 내려받지 않았습니다. 서버에 연결한 뒤 다시 열어 주세요.'
      )
    return row ? { ...toDetail(row), offline: true } : null
  }
}
