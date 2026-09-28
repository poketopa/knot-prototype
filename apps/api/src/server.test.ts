import { describe, expect, it, vi } from 'vitest'

import type { AppConfig } from './config.js'
import type { Db } from './db.js'
import { buildServer } from './server.js'

const baseConfig: AppConfig = {
  env: 'test',
  host: '127.0.0.1',
  port: 0,
  databaseUrl: 'postgres://user:pass@localhost:5432/knot_test',
  migrationDatabaseUrl: 'postgres://user:pass@localhost:5432/knot_test',
  storageDriver: 'local',
  localStorageRoot: '/tmp/knot-test',
  authMode: 'github',
  githubClientId: null,
  githubClientSecret: null,
  oauthCallbackUrl: 'http://127.0.0.1:4310/v1/auth/github/callback',
  desktopScheme: 'knot-prototype',
  desktopCallbackPath: '/auth/callback',
  jsonBodyLimitBytes: 32 * 1024 * 1024,
  maxUploadBytes: 1024
}

describe('server errors', () => {
  it('maps schema validation to 400 without DB details', async () => {
    const app = buildServer({ config: configured(), db: fakeDb() })

    const response = await app.inject({
      method: 'PUT',
      url: '/v1/recordings/not-a-uuid',
      headers: { authorization: 'Bearer token' },
      payload: {}
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      code: 'SCHEMA_VALIDATION_FAILED',
      message: 'Request schema validation failed'
    })
    await app.close()
  })

  it('keeps auth attempts closed and does not insert rows when GitHub OAuth is missing', async () => {
    const db = fakeDb()
    const app = buildServer({ config: baseConfig, db })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/attempts',
      payload: { challenge: 'x'.repeat(43) }
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({ code: 'AUTH_NOT_CONFIGURED' })
    expect(db.query).not.toHaveBeenCalled()
    await app.close()
  })
})

function configured(): AppConfig {
  return {
    ...baseConfig,
    githubClientId: 'client',
    githubClientSecret: 'secret'
  }
}

function fakeDb(): Db {
  return {
    query: vi.fn(async () => {
      throw new Error('db should not be reached')
    }),
    connect: vi.fn(),
    end: vi.fn()
  } as unknown as Db
}
