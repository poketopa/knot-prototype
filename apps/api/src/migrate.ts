import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadConfig } from './config.js'
import { createPool } from './db.js'

export async function migrate(connectionString = loadConfig().migrationDatabaseUrl) {
  const db = createPool(connectionString)
  try {
    const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations')
    const initSql = await readFile(join(migrationsDir, '001_init.sql'), 'utf8')
    await db.query(initSql)
    await db.query(
      `INSERT INTO schema_migrations (version) VALUES ($1)
       ON CONFLICT (version) DO NOTHING`,
      ['001_init']
    )
    const meetingSummaryMigration = await db.query(
      'SELECT 1 FROM schema_migrations WHERE version = $1',
      ['002_meeting_summary']
    )
    if (meetingSummaryMigration.rowCount === 0) {
      const sql = await readFile(join(migrationsDir, '002_meeting_summary.sql'), 'utf8')
      const client = await db.connect()
      try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [
          '002_meeting_summary'
        ])
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    }
    await configureRuntimeRole(db)
  } finally {
    await db.end()
  }
}

async function configureRuntimeRole(db: ReturnType<typeof createPool>) {
  const runtimeUser = process.env.API_RUNTIME_DB_USER
  const runtimePassword = process.env.API_RUNTIME_DB_PASSWORD
  if (!runtimeUser || !runtimePassword) {
    return
  }

  await db.query(
    `DO $$
     BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(runtimeUser)}) THEN
         EXECUTE 'CREATE ROLE ' || quote_ident(${literal(runtimeUser)}) || ' LOGIN PASSWORD ' || quote_literal(${literal(runtimePassword)});
       END IF;
     END $$;`
  )
  await db.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(runtimeUser)}`)
  await db.query(
    `GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO ${quoteIdentifier(runtimeUser)}`
  )
  await db.query(`GRANT UPDATE (display_name) ON users TO ${quoteIdentifier(runtimeUser)}`)
  await db.query(
    `GRANT UPDATE (ticket_hash, ticket_expires_at, consumed_at, user_id) ON auth_attempts TO ${quoteIdentifier(runtimeUser)}`
  )
  await db.query(`GRANT UPDATE (revoked_at) ON sessions TO ${quoteIdentifier(runtimeUser)}`)
  await db.query(
    `GRANT UPDATE (published_analysis_id) ON recordings TO ${quoteIdentifier(runtimeUser)}`
  )
  await db.query(
    `GRANT UPDATE (status, receipt, completed_at, updated_at) ON uploads TO ${quoteIdentifier(runtimeUser)}`
  )
  await db.query(
    `GRANT UPDATE (latest_snapshot_id, latest_version, updated_at) ON domain_documents TO ${quoteIdentifier(runtimeUser)}`
  )
  await db.query(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quoteIdentifier(runtimeUser)}`
  )
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`
}

function literal(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
