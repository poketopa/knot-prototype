import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'

const composePath = 'compose.ec2.example.yml'
const envPath = '.env.prototype.production.example'
const backupScriptPath = 'deploy/prototype/backup-postgres.sh'
const readmePath = 'deploy/prototype/README.md'
const restoreGuidancePath = 'deploy/prototype/restore-guidance.md'

const compose = readFileSync(composePath, 'utf8')
const envExample = readFileSync(envPath, 'utf8')
const backupScript = readFileSync(backupScriptPath, 'utf8')
const readme = readFileSync(readmePath, 'utf8')
const restoreGuidance = readFileSync(restoreGuidancePath, 'utf8')
const apiServiceBlock = compose.match(/\n {2}api:\n[\s\S]*?\n {4}expose:/)?.[0] ?? ''
const migrateServiceBlock = compose.match(/\n {2}migrate:\n[\s\S]*?\n\n {2}api:/)?.[0] ?? ''

const makeBackupHarness = (dockerScript: string) => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'knot-backup-test-'))
  const fakeBin = join(tempRoot, 'bin')
  const backupDir = join(tempRoot, 'backups')
  const envFile = join(tempRoot, '.env.prototype.production')
  execFileSync('mkdir', ['-p', fakeBin])
  writeFileSync(envFile, 'POSTGRES_PASSWORD=fake\n')
  const fakeDocker = join(fakeBin, 'docker')
  writeFileSync(fakeDocker, dockerScript)
  chmodSync(fakeDocker, 0o755)
  return { backupDir, envFile, fakeBin }
}

const runBackup = ({ backupDir, envFile, fakeBin }: ReturnType<typeof makeBackupHarness>) =>
  execFileSync('sh', [backupScriptPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
      ENV_FILE: envFile,
      BACKUP_DIR: backupDir,
      BACKUP_TIMESTAMP: '20260929T000000Z'
    }
  })

const backupFiles = (backupDir: string) => readdirSync(backupDir).sort()

describe('EC2 deployment assets', () => {
  it('publishes only Caddy HTTP and HTTPS host ports', () => {
    expect(compose).toContain("'80:80'")
    expect(compose).toContain("'443:443'")
    expect(compose).not.toMatch(/['"]?4310:4310['"]?/)
    expect(compose).not.toMatch(/['"]?5432:5432['"]?/)
    expect(compose).toContain('expose:')
    expect(compose).toContain("- '4310'")
  })

  it('uses pinned major official Caddy and PostgreSQL images with a prebuilt ARM64 API image variable', () => {
    expect(compose).toContain('image: caddy:2-alpine')
    expect(compose).toContain('image: postgres:17-alpine')
    expect(compose).toContain('image: ${KNOT_API_IMAGE:?set KNOT_API_IMAGE}')
    expect(compose).toContain('platform: linux/arm64')
    expect(compose).not.toContain('build:')
  })

  it('separates migration credentials from the API runtime service', () => {
    expect(migrateServiceBlock).toContain('migrate:')
    expect(migrateServiceBlock).toContain("'@meeting-stt/api'")
    expect(migrateServiceBlock).toContain("'db:migrate'")
    expect(migrateServiceBlock).toContain(
      'MIGRATION_DATABASE_URL: postgres://knot_migrator:${POSTGRES_PASSWORD}@postgres:5432/knot_prototype'
    )
    expect(migrateServiceBlock).toContain('API_RUNTIME_DB_USER: knot_api_runtime')
    expect(migrateServiceBlock).toContain(
      'API_RUNTIME_DB_PASSWORD: ${API_RUNTIME_DB_PASSWORD:?set API_RUNTIME_DB_PASSWORD}'
    )
    expect(apiServiceBlock).toContain('condition: service_completed_successfully')
    expect(apiServiceBlock).toContain(
      'DATABASE_URL: postgres://knot_api_runtime:${API_RUNTIME_DB_PASSWORD}@postgres:5432/knot_prototype'
    )
    expect(apiServiceBlock).not.toContain('MIGRATION_DATABASE_URL')
    expect(apiServiceBlock).not.toContain('POSTGRES_PASSWORD')
    expect(apiServiceBlock).not.toContain('API_RUNTIME_DB_USER')
    expect(apiServiceBlock).not.toContain('API_RUNTIME_DB_PASSWORD:')
  })

  it('declares the S3 storage environment contract fail-closed and without static AWS credentials', () => {
    for (const key of [
      'STORAGE_DRIVER=s3',
      'AWS_REGION=ap-northeast-2',
      'S3_BUCKET=your-private-bucket',
      'S3_PREFIX=knot/prototype-private/recordings',
      'S3_PRIVATE_PREFIX_CONFIRMED=false'
    ]) {
      expect(envExample).toContain(key)
    }
    expect(envExample).toContain('KNOT_API_DOMAIN=api.example.com')
    expect(`${compose}\n${envExample}`).not.toMatch(
      /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN/
    )
  })

  it('bounds Docker json-file logs for every service', () => {
    expect(compose).toContain('logging: &bounded-logging')
    for (const service of ['postgres', 'migrate', 'api']) {
      expect(compose).toMatch(
        new RegExp(`\\n  ${service}:\\n[\\s\\S]*?logging: \\*bounded-logging`)
      )
    }
    expect(compose).toContain('max-size: 10m')
    expect(compose).toContain("max-file: '3'")
  })

  it('keeps backup local, non-destructive, and operator-guided', () => {
    expect(backupScript).toContain('pg_dump --format=custom')
    expect(backupScript).toContain('umask 077')
    expect(backupScript).toContain('BACKUP_DB_USER')
    expect(backupScript).not.toMatch(/\nUSER=/)
    expect(backupScript).toContain('reserve_backup_slot')
    expect(backupScript).toContain('mkdir "$reserve_dir"')
    expect(backupScript).toContain('rm -rf "$reserve_dir"')
    expect(backupScript).not.toMatch(/aws\s+s3|s3:\/\//)
    expect(backupScript).not.toMatch(/pg_restore|dropdb|docker\s+compose[^\n]*(down|rm)/)
    expect(restoreGuidance).toContain('비파괴 복구 리허설')
    expect(readme).toContain('기존 프록시')
  })

  it('creates a local dump and hash sidecar without leaking dump bytes to stdout', () => {
    const harness = makeBackupHarness('#!/usr/bin/env sh\nprintf fake-dump-bytes\n')
    const stdout = runBackup(harness)

    expect(stdout).toContain('Created backup:')
    expect(stdout).toContain('Created hash:')
    expect(stdout).not.toContain('fake-dump-bytes')
    const files = backupFiles(harness.backupDir)
    const dump = files.find((name) => name.endsWith('.dump'))
    const hash = files.find((name) => name.endsWith('.dump.sha256'))
    expect(dump).toBeTruthy()
    expect(hash).toBeTruthy()
    expect(readFileSync(join(harness.backupDir, dump ?? ''), 'utf8')).toBe('fake-dump-bytes')
    expect(readFileSync(join(harness.backupDir, hash ?? ''), 'utf8')).toContain(dump)
    expect(readFileSync(join(harness.backupDir, hash ?? ''), 'utf8')).not.toContain(
      harness.backupDir
    )
    expect(files.some((name) => name.includes('.reserve') || name.endsWith('.partial'))).toBe(false)
    expect((statSync(join(harness.backupDir, dump ?? '')).mode & 0o077).toString(8)).toBe('0')
  })

  it('preserves both backups when two runs use the same timestamp', () => {
    const harness = makeBackupHarness('#!/usr/bin/env sh\nprintf same-timestamp-dump\n')

    runBackup(harness)
    runBackup(harness)

    const files = backupFiles(harness.backupDir)
    expect(files.filter((name) => name.endsWith('.dump'))).toEqual([
      'knot-prototype-postgres-20260929T000000Z-1.dump',
      'knot-prototype-postgres-20260929T000000Z.dump'
    ])
    expect(files.filter((name) => name.endsWith('.dump.sha256'))).toEqual([
      'knot-prototype-postgres-20260929T000000Z-1.dump.sha256',
      'knot-prototype-postgres-20260929T000000Z.dump.sha256'
    ])
  })

  it('does not leave completed dump or hash files when pg_dump fails', () => {
    const harness = makeBackupHarness('#!/usr/bin/env sh\nprintf partial-bytes\n\nexit 42\n')

    expect(() => runBackup(harness)).toThrow()

    expect(backupFiles(harness.backupDir)).toEqual([])
  })

  it('is accepted by docker compose config with fail-closed fake example values', () => {
    const rendered = execFileSync(
      'docker',
      ['compose', '--env-file', envPath, '-f', composePath, 'config'],
      { encoding: 'utf8' }
    )
    expect(rendered).toContain('knot-prototype-ec2')
    expect(rendered).toContain('target: 80')
    expect(rendered).toContain('target: 443')
    expect(rendered).toContain('S3_PRIVATE_PREFIX_CONFIRMED: "false"')
  })

  it('has shell syntax-valid backup script', () => {
    expect(() => execFileSync('bash', ['-n', backupScriptPath])).not.toThrow()
  })
})
