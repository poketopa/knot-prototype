import type {
  PrototypeDecisionItem,
  PrototypeDocumentDetail,
  PrototypeOutlineSection,
  PrototypeSummarySection
} from '@shared/prototype'
import { prototypeBroadDocumentDomain } from '@shared/prototype'
import { TOPIC_ANALYSIS_PROMPT_VERSION } from '@shared/summary'
import type {
  TopicAnalysisAttempt,
  TopicAnalysisResult,
  TopicAnalysisUtterance
} from '@shared/types'
import { getDb } from '../db/connection'
import { runTopicAnalysis } from '../summary/run'
import { preserveAiFailureArtifact, preserveTopicAnalysisArtifacts } from './artifacts'
import { requirePrototypeUser } from './authState'
import { emitPrototypeChanged } from './events'
import { checkpointAiPublish } from '../pipeline/queue'
import { getRecordingState } from '../audio/session'

export const DOCUMENT_REANALYSIS_PROMPT_VERSION = `${TOPIC_ANALYSIS_PROMPT_VERSION}:document-reanalysis-20260930`

interface ReanalysisCandidate {
  recording_id: string
  title: string
  created_at: number
  duration_sec: number
  transcript_artifact_id: string
  transcript_content_json: string
}

interface ReanalysisFailure {
  recordingId: string
  title: string
  error: string
}

export interface ReanalyzePrototypeDocumentsResponse {
  requested: number
  processed: number
  skipped: number
  failed: number
  failures: ReanalysisFailure[]
}

let activeRun: Promise<ReanalyzePrototypeDocumentsResponse> | null = null
let activeOwnerId: string | null = null

const messageOf = (caught: unknown) => (caught instanceof Error ? caught.message : String(caught))

const assertOwner = (ownerId: string) => {
  if (requirePrototypeUser().id !== ownerId) throw new Error('계정이 변경되었습니다')
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const parseTranscriptUtterances = ({
  contentJson,
  recordingId
}: {
  contentJson: string
  recordingId: string
}): TopicAnalysisUtterance[] => {
  const content = JSON.parse(contentJson) as unknown
  if (!isRecord(content) || !Array.isArray(content.utterances)) {
    throw new Error('전사 산출물이 올바르지 않습니다')
  }

  return content.utterances.map((utterance, index): TopicAnalysisUtterance => {
    if (!isRecord(utterance)) throw new Error('전사 산출물이 올바르지 않습니다')
    if (typeof utterance.id !== 'string') throw new Error('전사 산출물이 올바르지 않습니다')
    if (typeof utterance.text !== 'string') throw new Error('전사 산출물이 올바르지 않습니다')
    if (typeof utterance.speakerLabel !== 'string') {
      throw new Error('전사 산출물이 올바르지 않습니다')
    }
    if ('meetingId' in utterance && utterance.meetingId !== recordingId) {
      throw new Error('전사 산출물이 다른 녹음을 참조합니다')
    }

    return {
      id: utterance.id,
      speakerLabel: utterance.speakerLabel,
      text: utterance.text,
      startSec: typeof utterance.startSec === 'number' ? utterance.startSec : index
    }
  })
}

const renderBody = ({
  title,
  summarySections,
  outline
}: Pick<PrototypeDocumentDetail, 'title' | 'summarySections' | 'outline'>) =>
  [
    `# ${title}`,
    ...(summarySections ?? []).map((section) => `## ${section.heading}\n\n${section.text}`),
    ...(outline ?? []).map(
      (section) =>
        `## ${section.heading}\n\n${section.items.map((item) => `- ${item.text}`).join('\n')}`
    )
  ].join('\n\n')

const topicDetail = ({
  topic,
  candidate
}: {
  topic: Extract<TopicAnalysisResult, { schemaVersion: 2 }>['topics'][number]
  candidate: ReanalysisCandidate
}): PrototypeDocumentDetail => {
  const domain = prototypeBroadDocumentDomain({
    domain: topic.domain,
    title: topic.title,
    overview: topic.summarySections[0]?.text
  })
  const contributionSection = {
    overview: topic.summarySections.map((section) => section.text).join(' '),
    decisions: [] as PrototypeDecisionItem[],
    unresolved: [] as PrototypeDecisionItem[]
  }

  return {
    id: topic.documentId,
    title: topic.title,
    domain,
    recordingId: candidate.recording_id,
    recordingStartedAt: new Date(candidate.created_at).toISOString(),
    durationSec: candidate.duration_sec > 0 ? candidate.duration_sec : undefined,
    transcriptArtifactId: candidate.transcript_artifact_id,
    version: 1,
    summarySections: topic.summarySections as PrototypeSummarySection[],
    outline: topic.outline as PrototypeOutlineSection[],
    body: renderBody({
      title: topic.title,
      summarySections: topic.summarySections,
      outline: topic.outline
    }),
    contributions: [
      {
        recordingId: candidate.recording_id,
        startedAt: new Date(candidate.created_at).toISOString(),
        section: contributionSection
      }
    ],
    offline: true
  }
}

const replaceLocalDocumentTree = ({
  ownerId,
  candidate,
  result
}: {
  ownerId: string
  candidate: ReanalysisCandidate
  result: TopicAnalysisResult
}) => {
  if (result.schemaVersion !== 2) return

  const db = getDb()
  const updatedAt = new Date().toISOString()
  const insert = db.prepare(
    `INSERT INTO prototype_document_tree
      (id,owner_id,title,domain,recording_id,recording_started_at,latest_version,overview,detail_json,updated_at)
     VALUES
      (@id,@ownerId,@title,@domain,@recordingId,@recordingStartedAt,@latestVersion,@overview,@detailJson,@updatedAt)`
  )

  db.transaction(() => {
    db.prepare('DELETE FROM prototype_document_tree WHERE owner_id = ? AND recording_id = ?').run(
      ownerId,
      candidate.recording_id
    )

    for (const topic of result.topics) {
      const detail = topicDetail({ topic, candidate })
      insert.run({
        id: topic.documentId,
        ownerId,
        title: topic.title,
        domain: detail.domain,
        recordingId: candidate.recording_id,
        recordingStartedAt: detail.recordingStartedAt,
        latestVersion: 1,
        overview: topic.summarySections[0]?.text ?? null,
        detailJson: JSON.stringify(detail),
        updatedAt
      })
    }
  })()
}

const candidates = ({ ownerId }: { ownerId: string }) =>
  getDb()
    .prepare(
      `SELECT
         m.id AS recording_id,
         m.title,
         m.created_at,
         m.duration_sec,
         (
           SELECT t.id
           FROM prototype_artifacts t
           WHERE t.owner_id=m.owner_id
             AND t.recording_id=m.id
             AND t.kind='transcript'
           ORDER BY t.created_at DESC,t.rowid DESC
           LIMIT 1
         ) AS transcript_artifact_id,
         (
           SELECT t.content_json
           FROM prototype_artifacts t
           WHERE t.owner_id=m.owner_id
             AND t.recording_id=m.id
             AND t.kind='transcript'
           ORDER BY t.created_at DESC,t.rowid DESC
           LIMIT 1
         ) AS transcript_content_json
       FROM meetings m
       WHERE m.owner_id=@ownerId
         AND m.status='done'
         AND EXISTS (
           SELECT 1 FROM prototype_artifacts t
           WHERE t.owner_id=m.owner_id
             AND t.recording_id=m.id
             AND t.kind='transcript'
             AND t.content_json IS NOT NULL
         )
         AND NOT EXISTS (
           SELECT 1 FROM prototype_jobs j
           WHERE j.owner_id=m.owner_id
             AND j.recording_id=m.id
             AND j.status IN ('pending','running')
             AND j.kind IN ('transcript','ai','publish')
         )
         AND NOT EXISTS (
           SELECT 1
           FROM prototype_artifacts a
           JOIN prototype_outbox o
             ON o.owner_id=a.owner_id
            AND o.kind='publish'
            AND json_extract(o.payload_json,'$.recordingId')=a.recording_id
            AND json_extract(o.payload_json,'$.analysisArtifactId')=a.id
            AND o.status IN ('pending','succeeded')
           WHERE a.owner_id=m.owner_id
             AND a.recording_id=m.id
             AND a.kind='ai_analysis'
             AND a.prompt_version=@promptVersion
         )
       ORDER BY m.created_at`
    )
    .all({ ownerId, promptVersion: DOCUMENT_REANALYSIS_PROMPT_VERSION }) as ReanalysisCandidate[]

const broadDomainCatalog = (ownerId: string) => {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT domain,title,overview
       FROM prototype_document_tree
       WHERE owner_id=@ownerId`
    )
    .all({ ownerId }) as Array<{
    domain: string
    title: string
    overview: string | null
  }>
  const domains = [...new Set(rows.map((row) => prototypeBroadDocumentDomain(row)).filter(Boolean))]

  return domains.map((domain) => ({ id: domain, title: domain, domain }))
}

const artifactAttempt = (attempt: TopicAnalysisAttempt): TopicAnalysisAttempt => ({
  ...attempt,
  promptVersion: DOCUMENT_REANALYSIS_PROMPT_VERSION
})

export const reanalyzePrototypeDocuments =
  async (): Promise<ReanalyzePrototypeDocumentsResponse> => {
    const owner = requirePrototypeUser()
    if (activeRun) {
      if (activeOwnerId === owner.id) return activeRun
      throw new Error('다른 계정의 문서 재정리가 진행 중입니다')
    }

    activeOwnerId = owner.id
    activeRun = runReanalysis(owner.id).finally(() => {
      activeRun = null
      activeOwnerId = null
    })

    return activeRun
  }

const runReanalysis = async (ownerId: string): Promise<ReanalyzePrototypeDocumentsResponse> => {
  assertOwner(ownerId)
  if (getRecordingState().meetingId) {
    throw new Error('녹음 중에는 기존 문서를 다시 정리할 수 없습니다')
  }

  const targets = candidates({ ownerId })
  const result: ReanalyzePrototypeDocumentsResponse = {
    requested: targets.length,
    processed: 0,
    skipped: 0,
    failed: 0,
    failures: []
  }

  for (const candidate of targets) {
    assertOwner(ownerId)
    const utterances = parseTranscriptUtterances({
      contentJson: candidate.transcript_content_json,
      recordingId: candidate.recording_id
    })
    if (!utterances.length) {
      result.skipped += 1
      continue
    }

    try {
      const attempt = await runTopicAnalysis({
        meetingId: candidate.recording_id,
        utterances: utterances.map((utterance) => ({
          id: utterance.id,
          speakerLabel: utterance.speakerLabel,
          text: utterance.text,
          startSec: utterance.startSec
        })),
        documents: broadDomainCatalog(ownerId),
        onProgress: () => {}
      })
      assertOwner(ownerId)
      const versionedAttempt = artifactAttempt(attempt)
      const analysisArtifactId = await preserveTopicAnalysisArtifacts({
        recordingId: candidate.recording_id,
        attempt: versionedAttempt,
        expectedOwnerId: ownerId
      })
      assertOwner(ownerId)
      checkpointAiPublish({
        recordingId: candidate.recording_id,
        analysisArtifactId,
        transcriptArtifactId: candidate.transcript_artifact_id,
        replaceRecordingDocuments: true,
        forcePublish: true
      })
      assertOwner(ownerId)
      replaceLocalDocumentTree({
        ownerId,
        candidate,
        result: versionedAttempt.result
      })
      result.processed += 1
      emitPrototypeChanged({ reason: 'documents', recordingId: candidate.recording_id })
    } catch (caught) {
      if (requirePrototypeUser().id !== ownerId) throw caught
      const error = messageOf(caught)
      await preserveAiFailureArtifact({
        recordingId: candidate.recording_id,
        errorMessage: error
      }).catch(() => {})
      result.failed += 1
      result.failures.push({
        recordingId: candidate.recording_id,
        title: candidate.title,
        error
      })
    }
  }

  emitPrototypeChanged({ reason: 'processing' })
  return result
}
