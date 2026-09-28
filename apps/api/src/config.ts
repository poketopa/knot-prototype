import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

export type AppConfig = {
  env: 'local' | 'test' | 'production'
  host: string
  port: number
  databaseUrl: string
  migrationDatabaseUrl: string
  storageDriver: 'local' | 's3'
  s3?: { bucket: string; teamPrefix: string; region: string; spoolRoot: string }
  localStorageRoot: string
  authMode: 'github'
  githubClientId: string | null
  githubClientSecret: string | null
  oauthCallbackUrl: string
  desktopScheme: string
  desktopCallbackPath: string
  jsonBodyLimitBytes: number
  maxUploadBytes: number
}

export function loadConfig(env = process.env): AppConfig {
  const appEnv = parseEnv(env.APP_ENV)
  const host = env.API_HOST ?? '127.0.0.1'
  const port = Number(env.PORT ?? '4310')
  const storageDriver = env.STORAGE_DRIVER ?? 'local'
  const authMode = env.AUTH_MODE ?? 'github'
  const databaseUrl = required(env.DATABASE_URL, 'DATABASE_URL')
  const migrationDatabaseUrl = env.MIGRATION_DATABASE_URL ?? databaseUrl
  const localStorageRoot = resolve(env.LOCAL_STORAGE_ROOT ?? './var/prototype-storage')
  const oauthCallbackUrl = env.OAUTH_CALLBACK_URL ?? 'http://127.0.0.1:4310/v1/auth/github/callback'
  const desktopScheme = env.DESKTOP_SCHEME ?? 'knot-prototype'
  const desktopCallbackPath = env.DESKTOP_CALLBACK_PATH ?? '/auth/callback'
  const jsonBodyLimitBytes = Number(env.JSON_BODY_LIMIT_BYTES ?? String(32 * 1024 * 1024))
  const maxUploadBytes = Number(env.MAX_UPLOAD_BYTES ?? String(1024 * 1024 * 1024))

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('PORT_INVALID')
  }
  if (storageDriver !== 'local' && storageDriver !== 's3') {
    throw new Error('STORAGE_DRIVER_INVALID')
  }
  if (authMode !== 'github') {
    throw new Error('ONLY_GITHUB_AUTH_ENABLED')
  }
  if (appEnv === 'local') {
    if (storageDriver !== 'local') throw new Error('S3_DISABLED_IN_LOCAL')
    rejectNonLoopback(host, 'API_HOST', env.CONTAINER === 'true')
    rejectRemoteDatabase(databaseUrl)
    rejectRemoteDatabase(migrationDatabaseUrl)
  }
  if (appEnv === 'production' && (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET)) {
    throw new Error('GITHUB_OAUTH_REQUIRED_IN_PRODUCTION')
  }
  if (appEnv === 'production') {
    const callback = new URL(oauthCallbackUrl)
    if (
      callback.protocol !== 'https:' ||
      callback.username ||
      callback.password ||
      callback.search ||
      callback.hash ||
      callback.pathname !== '/v1/auth/github/callback'
    ) {
      throw new Error('OAUTH_CALLBACK_MUST_BE_HTTPS_IN_PRODUCTION')
    }
  }
  if (!Number.isFinite(jsonBodyLimitBytes) || jsonBodyLimitBytes <= 0) {
    throw new Error('JSON_BODY_LIMIT_BYTES_INVALID')
  }
  if (!Number.isSafeInteger(maxUploadBytes) || maxUploadBytes <= 0 || maxUploadBytes > 1024 ** 3) {
    throw new Error('MAX_UPLOAD_BYTES_INVALID')
  }

  let s3: AppConfig['s3']
  if (storageDriver === 's3') {
    const bucket = required(env.S3_BUCKET, 'S3_BUCKET')
    const teamPrefix = required(env.S3_PREFIX, 'S3_PREFIX').replace(/\/+$/, '')
    const region = required(env.AWS_REGION, 'AWS_REGION')
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('S3_BUCKET_INVALID')
    if (!/^knot\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(teamPrefix)) {
      throw new Error('S3_PREFIX_MUST_BE_WITHIN_KNOT')
    }
    // This is an operator assertion, not an AWS policy inspection.
    if (env.S3_PRIVATE_PREFIX_CONFIRMED !== 'true')
      throw new Error('S3_PRIVATE_PREFIX_NOT_CONFIRMED')
    s3 = { bucket, teamPrefix, region, spoolRoot: resolve(localStorageRoot, 's3-spool') }
  }

  mkdirSync(localStorageRoot, { recursive: true })

  return {
    env: appEnv,
    host,
    port,
    databaseUrl,
    migrationDatabaseUrl,
    storageDriver,
    s3,
    localStorageRoot,
    authMode: 'github',
    githubClientId: env.GITHUB_CLIENT_ID ?? null,
    githubClientSecret: env.GITHUB_CLIENT_SECRET ?? null,
    oauthCallbackUrl,
    desktopScheme,
    desktopCallbackPath,
    jsonBodyLimitBytes,
    maxUploadBytes
  }
}

function parseEnv(value: string | undefined): AppConfig['env'] {
  if (value === undefined || value === 'local') {
    return 'local'
  }
  if (value === 'test' || value === 'production') {
    return value
  }
  throw new Error('APP_ENV_INVALID')
}

function required(value: string | undefined, key: string): string {
  if (!value) {
    throw new Error(`${key}_REQUIRED`)
  }
  return value
}

function rejectNonLoopback(value: string, key: string, allowContainerBindAll: boolean) {
  if (
    value !== '127.0.0.1' &&
    value !== 'localhost' &&
    !(allowContainerBindAll && value === '0.0.0.0')
  ) {
    throw new Error(`${key}_MUST_BE_LOOPBACK_IN_LOCAL`)
  }
}

function rejectRemoteDatabase(databaseUrl: string) {
  const url = new URL(databaseUrl)
  if (!['localhost', '127.0.0.1', 'postgres'].includes(url.hostname)) {
    throw new Error('DATABASE_URL_MUST_BE_LOCAL_IN_LOCAL')
  }
}
