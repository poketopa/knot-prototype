import { createHash } from 'node:crypto'
import type {
  PrototypeDocumentContribution,
  PrototypeDocumentDetail,
  PrototypeDocumentListItem,
  PrototypeOutlineSection,
  PrototypeSummarySection
} from '@shared/prototype'
import { getDb } from '../db/connection'
import { requirePrototypeUser } from './authState'
import { PrototypeApiError, prototypeRequest } from './apiClient'

interface TreeItem extends PrototypeDocumentListItem {
  domain: string
  recordingId: string
  recordingStartedAt: string
}
interface RemoteDetail extends TreeItem {
  transcriptArtifactId?: string
  body: {
    schemaVersion: 2
    summarySections: PrototypeSummarySection[]
    outline: PrototypeOutlineSection[]
  }
}
interface TreeRow {
  id: string
  title: string
  domain: string
  recording_id: string
  recording_started_at: string
  latest_version: number
  overview: string | null
  detail_json: string | null
  updated_at: string
}

const renderBody = (
  document: Pick<PrototypeDocumentDetail, 'title' | 'summarySections' | 'outline'>
) =>
  [
    `# ${document.title}`,
    ...(document.summarySections ?? []).map(
      (section) => `## ${section.heading}\n\n${section.text}`
    ),
    ...(document.outline?.length ? ['---', '## 논의 상세'] : []),
    ...(document.outline ?? []).map(
      (section) =>
        `### ${section.heading}\n\n${section.items.map((item) => `- ${item.text}`).join('\n')}`
    )
  ].join('\n\n')

const toDetail = (document: RemoteDetail): PrototypeDocumentDetail => ({
  id: document.id,
  title: document.title,
  domain: document.domain,
  recordingId: document.recordingId,
  recordingStartedAt: document.recordingStartedAt,
  transcriptArtifactId: document.transcriptArtifactId,
  version: document.latestVersion,
  summarySections: document.body.summarySections,
  outline: document.body.outline,
  body: renderBody({ title: document.title, ...document.body }),
  contributions: [
    {
      recordingId: document.recordingId,
      startedAt: document.recordingStartedAt,
      section: {
        overview: document.body.summarySections.map((section) => section.text).join(' '),
        decisions: [],
        unresolved: []
      }
    }
  ]
})

const cacheItem = (ownerId: string, item: TreeItem, detail?: PrototypeDocumentDetail) => {
  getDb()
    .prepare(
      `INSERT INTO prototype_document_tree
    (id,owner_id,title,domain,recording_id,recording_started_at,latest_version,overview,detail_json,updated_at)
    VALUES (@id,@ownerId,@title,@domain,@recordingId,@recordingStartedAt,@latestVersion,@overview,@detailJson,@updatedAt)
    ON CONFLICT(owner_id,id) DO UPDATE SET
      title=excluded.title, domain=excluded.domain, recording_id=excluded.recording_id,
      recording_started_at=excluded.recording_started_at, overview=excluded.overview,
      latest_version=CASE WHEN excluded.detail_json IS NOT NULL OR prototype_document_tree.detail_json IS NULL
        THEN excluded.latest_version ELSE prototype_document_tree.latest_version END,
      detail_json=COALESCE(excluded.detail_json,prototype_document_tree.detail_json), updated_at=excluded.updated_at`
    )
    .run({
      ...item,
      ownerId,
      overview: item.overview ?? null,
      detailJson: detail ? JSON.stringify(detail) : null
    })
}

const rowToItem = (row: TreeRow): TreeItem => ({
  id: row.id,
  title: row.title,
  domain: row.domain,
  recordingId: row.recording_id,
  recordingStartedAt: row.recording_started_at,
  latestVersion: row.latest_version,
  updatedAt: row.updated_at,
  ...(row.overview ? { overview: row.overview } : {})
})
const assertOwner = (ownerId: string) => {
  if (requirePrototypeUser().id !== ownerId) throw new Error('계정이 변경되었습니다')
}

/** 이전 누적 캐시는 원본을 남겨두고 회의별 읽기 전용 문서로 투영한다. */
export const legacyDocumentId = (documentId: string, recordingId: string) => {
  const bytes = createHash('sha256')
    .update(`legacy-document:${documentId}:${recordingId}`)
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const populateLocalTree = (ownerId: string) => {
  const db = getDb()
  const legacy = db
    .prepare('SELECT * FROM prototype_documents WHERE owner_id = ?')
    .all(ownerId) as Array<{
    id: string
    title: string
    contributions: string
    updated_at: string
  }>
  for (const row of legacy) {
    let contributions: PrototypeDocumentContribution[]
    try {
      contributions = JSON.parse(row.contributions)
    } catch {
      continue
    }
    for (const contribution of contributions) {
      const summarySections = contribution.section.overview?.trim()
        ? [{ heading: '핵심 내용', text: contribution.section.overview, sourceUtteranceIds: [] }]
        : []
      const points = [
        ...contribution.section.decisions,
        ...contribution.section.unresolved.map((point) => ({
          ...point,
          text: `아직 정해지지 않은 내용: ${point.text}`
        }))
      ]
      const outline = points.length ? [{ heading: '논의한 내용', items: points }] : []
      if (!summarySections.length && !outline.length) continue
      const item: TreeItem = {
        id: legacyDocumentId(row.id, contribution.recordingId),
        title: row.title,
        domain: row.title,
        recordingId: contribution.recordingId,
        recordingStartedAt: contribution.startedAt,
        latestVersion: 1,
        updatedAt: row.updated_at,
        overview: summarySections[0]?.text
      }
      if (
        !db
          .prepare('SELECT 1 FROM prototype_document_tree WHERE owner_id = ? AND id = ?')
          .get(ownerId, item.id)
      )
        cacheItem(
          ownerId,
          item,
          toDetail({ ...item, body: { schemaVersion: 2, summarySections, outline } })
        )
    }
  }
  const analyses = db
    .prepare(
      `SELECT a.content_json,a.recording_id,m.created_at
    FROM prototype_artifacts a JOIN meetings m ON m.id=a.recording_id AND m.owner_id=a.owner_id
    WHERE a.owner_id=? AND a.kind='ai_analysis' ORDER BY a.created_at`
    )
    .all(ownerId) as Array<{
    content_json: string | null
    recording_id: string
    created_at: number
  }>
  for (const row of analyses) {
    let analysis
    try {
      analysis = row.content_json ? JSON.parse(row.content_json) : null
    } catch {
      continue
    }
    if (analysis?.schemaVersion !== 2 || !Array.isArray(analysis.topics)) continue
    for (const topic of analysis.topics) {
      if (
        !topic.documentId ||
        !Array.isArray(topic.summarySections) ||
        !Array.isArray(topic.outline)
      )
        continue
      if (
        db
          .prepare('SELECT 1 FROM prototype_document_tree WHERE owner_id=? AND id=?')
          .get(ownerId, topic.documentId)
      )
        continue
      const date = new Date(row.created_at).toISOString()
      const item: TreeItem = {
        id: topic.documentId,
        title: topic.title,
        domain: topic.domain,
        recordingId: row.recording_id,
        recordingStartedAt: date,
        latestVersion: 1,
        updatedAt: date,
        overview: topic.summarySections[0]?.text
      }
      cacheItem(
        ownerId,
        item,
        toDetail({
          ...item,
          body: {
            schemaVersion: 2,
            summarySections: topic.summarySections,
            outline: topic.outline
          }
        })
      )
    }
  }
}

const cachedItems = (ownerId: string) =>
  (
    getDb()
      .prepare(
        `SELECT * FROM prototype_document_tree
  WHERE owner_id=? ORDER BY recording_started_at DESC,id`
      )
      .all(ownerId) as TreeRow[]
  ).map(rowToItem)

/** 로컬 산출물은 원격 업로드가 끝나기 전부터 문서 트리에 포함된다. */
export const listPrototypeDocuments = async (): Promise<PrototypeDocumentListItem[]> => {
  const ownerId = requirePrototypeUser().id
  populateLocalTree(ownerId)
  try {
    const remote = await prototypeRequest<{ documents: TreeItem[] }>({ path: '/document-tree' })
    assertOwner(ownerId)
    getDb().transaction(() => {
      for (const item of remote.documents) cacheItem(ownerId, item)
    })()
    const items = new Map(cachedItems(ownerId).map((item) => [item.id, item]))
    for (const item of remote.documents) items.set(item.id, item)
    return [...items.values()].sort((a, b) =>
      b.recordingStartedAt.localeCompare(a.recordingStartedAt)
    )
  } catch {
    assertOwner(ownerId)
    return cachedItems(ownerId)
  }
}

export const getPrototypeDocument = async ({
  documentId
}: {
  documentId: string
}): Promise<PrototypeDocumentDetail | null> => {
  const ownerId = requirePrototypeUser().id
  populateLocalTree(ownerId)
  try {
    const remote = await prototypeRequest<RemoteDetail>({ path: `/document-tree/${documentId}` })
    assertOwner(ownerId)
    const detail = toDetail(remote)
    cacheItem(ownerId, remote, detail)
    return detail
  } catch (caught) {
    assertOwner(ownerId)
    const row = getDb()
      .prepare('SELECT * FROM prototype_document_tree WHERE owner_id=? AND id=?')
      .get(ownerId, documentId) as TreeRow | undefined
    if (!row) {
      if (caught instanceof PrototypeApiError && caught.status === 404) return null
      throw caught
    }
    if (!row.detail_json)
      throw new Error(
        '이 문서는 아직 이 Mac에 내려받지 않았습니다. 서버에 연결한 뒤 다시 열어 주세요.'
      )
    return { ...(JSON.parse(row.detail_json) as PrototypeDocumentDetail), offline: true }
  }
}
