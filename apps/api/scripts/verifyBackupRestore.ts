import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

import { createPool, type Db } from '../src/db.js'

const execFile = promisify(execFileCallback)

type DbSnapshot = {
  tableCounts: Record<string, number>
  documentSnapshots: Array<{
    userId: string
    documentId: string
    version: number
    bodyHash: string
  }>
  artifacts: Array<{
    userId: string
    artifactId: string
    sha256: string
    byteLength: string
    contentHash: string
  }>
}

async function main() {
  const sourceUrl = requiredEnv('SOURCE_DATABASE_URL')
  const restoreUrl = requiredEnv('RESTORE_DATABASE_URL')
  const adminUrl = process.env.ADMIN_DATABASE_URL
  const restoreName = new URL(restoreUrl).pathname.slice(1)
  if (!sourceUrl.includes('test') || !restoreUrl.includes('test')) {
    throw new Error(
      'SOURCE_DATABASE_URL and RESTORE_DATABASE_URL must be disposable test databases'
    )
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'knot-api-backup-'))
  const dumpPath = join(tempDir, 'knot-prototype-test.dump')
  try {
    if (adminUrl) {
      await recreateDatabase(adminUrl, restoreName)
    }

    await execFile('pg_dump', ['--format=custom', '--file', dumpPath, sourceUrl])
    await execFile('pg_restore', [
      '--clean',
      '--if-exists',
      '--no-owner',
      '--dbname',
      restoreUrl,
      dumpPath
    ])

    const source = createPool(sourceUrl)
    const restored = createPool(restoreUrl)
    try {
      const sourceSnapshot = await readSnapshot(source)
      const restoredSnapshot = await readSnapshot(restored)
      assertDeepEqual(restoredSnapshot, sourceSnapshot)
      console.log(JSON.stringify({ ok: true, ...sourceSnapshot }, null, 2))
    } finally {
      await source.end()
      await restored.end()
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function recreateDatabase(adminUrl: string, databaseName: string) {
  const admin = createPool(adminUrl)
  try {
    await admin.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [databaseName]
    )
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`)
    await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`)
  } finally {
    await admin.end()
  }
}

async function readSnapshot(db: Db): Promise<DbSnapshot> {
  const tables = [
    'users',
    'auth_attempts',
    'sessions',
    'recordings',
    'artifacts',
    'uploads',
    'domain_documents',
    'document_contributions',
    'document_snapshots',
    'recording_publishes',
    'events'
  ]
  const tableCounts: Record<string, number> = {}
  for (const table of tables) {
    const count = await db.query<{ count: string }>(`SELECT count(*) AS count FROM ${table}`)
    tableCounts[table] = Number(count.rows[0].count)
  }
  const documentSnapshots = await db.query<DbSnapshot['documentSnapshots'][number]>(
    `SELECT
       user_id AS "userId",
       document_id AS "documentId",
       version,
       encode(digest(body::text, 'sha256'), 'hex') AS "bodyHash"
     FROM document_snapshots
     ORDER BY user_id, document_id, version`
  )
  const artifacts = await db.query<DbSnapshot['artifacts'][number]>(
    `SELECT
       user_id AS "userId",
       id AS "artifactId",
       sha256,
       byte_length::text AS "byteLength",
       content_hash AS "contentHash"
     FROM artifacts
     ORDER BY user_id, id`
  )
  return {
    tableCounts,
    documentSnapshots: documentSnapshots.rows,
    artifacts: artifacts.rows
  }
}

function assertDeepEqual(actual: unknown, expected: unknown) {
  const actualJson = JSON.stringify(actual)
  const expectedJson = JSON.stringify(expected)
  if (actualJson !== expectedJson) {
    throw new Error(`backup restore mismatch\nactual=${actualJson}\nexpected=${expectedJson}`)
  }
}

function requiredEnv(key: string) {
  const value = process.env[key]
  if (!value) {
    throw new Error(`${key} is required`)
  }
  return value
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
