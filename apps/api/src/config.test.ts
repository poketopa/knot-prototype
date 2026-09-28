import { describe, expect, it } from 'vitest'

import { loadConfig } from './config.js'

const baseEnv = {
  APP_ENV: 'local',
  API_HOST: '127.0.0.1',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/knot_prototype',
  STORAGE_DRIVER: 'local',
  AUTH_MODE: 'github'
}

describe('loadConfig', () => {
  const productionEnv = {
    ...baseEnv,
    APP_ENV: 'production',
    API_HOST: '0.0.0.0',
    GITHUB_CLIENT_ID: 'fixture-client',
    GITHUB_CLIENT_SECRET: 'fixture-secret',
    OAUTH_CALLBACK_URL: 'https://api.knot.example/v1/auth/github/callback',
    STORAGE_DRIVER: 's3',
    AWS_REGION: 'ap-northeast-2',
    S3_BUCKET: 'fixture-bucket',
    S3_PREFIX: 'knot/prototype-private',
    S3_PRIVATE_PREFIX_CONFIRMED: 'true',
    S3_PUBLIC_READ_ACKNOWLEDGED: 'false'
  }

  it('requires an explicit private or public-read S3 access-mode assertion before enabling S3', () => {
    expect(() =>
      loadConfig({
        ...productionEnv,
        S3_PRIVATE_PREFIX_CONFIRMED: 'false',
        S3_PUBLIC_READ_ACKNOWLEDGED: 'false'
      })
    ).toThrow('S3_ACCESS_MODE_NOT_CONFIRMED')
    expect(loadConfig(productionEnv).s3).toMatchObject({
      bucket: 'fixture-bucket',
      teamPrefix: 'knot/prototype-private',
      region: 'ap-northeast-2'
    })
  })

  it('allows deliberate public-read S3 mode without pretending the prefix is private', () => {
    expect(
      loadConfig({
        ...productionEnv,
        S3_PREFIX: 'knot/prototype-public/recordings',
        S3_PRIVATE_PREFIX_CONFIRMED: 'false',
        S3_PUBLIC_READ_ACKNOWLEDGED: 'true'
      }).s3
    ).toMatchObject({
      bucket: 'fixture-bucket',
      teamPrefix: 'knot/prototype-public/recordings',
      region: 'ap-northeast-2'
    })
  })

  it.each(['other-team/private', 'knot', 'knot/../other-team', '/knot/private', 'knot//private'])(
    'rejects unsafe or out-of-team S3 prefix %s',
    (prefix) => {
      expect(() => loadConfig({ ...productionEnv, S3_PREFIX: prefix })).toThrow(
        'S3_PREFIX_MUST_BE_WITHIN_KNOT'
      )
    }
  )

  it('prevents local runs from reaching S3', () => {
    expect(() => loadConfig({ ...productionEnv, APP_ENV: 'local' })).toThrow('S3_DISABLED_IN_LOCAL')
  })

  it.each([
    'http://api.knot.example/v1/auth/github/callback',
    'https://api.knot.example/incorrect',
    'https://name:secret@api.knot.example/v1/auth/github/callback'
  ])('rejects unsafe production OAuth callback %s', (callback) => {
    expect(() => loadConfig({ ...productionEnv, OAUTH_CALLBACK_URL: callback })).toThrow(
      'OAUTH_CALLBACK_MUST_BE_HTTPS_IN_PRODUCTION'
    )
  })

  it('caps spool size at one GiB per upload', () => {
    expect(() => loadConfig({ ...productionEnv, MAX_UPLOAD_BYTES: String(2 * 1024 ** 3) })).toThrow(
      'MAX_UPLOAD_BYTES_INVALID'
    )
  })
  it('allows local loopback API and local database', () => {
    expect(loadConfig(baseEnv).host).toBe('127.0.0.1')
  })

  it('rejects remote databases in local mode', () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        DATABASE_URL: 'postgres://user:pass@example.com:5432/knot'
      })
    ).toThrow('DATABASE_URL_MUST_BE_LOCAL_IN_LOCAL')
  })

  it('rejects remote migration databases in local mode', () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        MIGRATION_DATABASE_URL: 'postgres://user:pass@example.com:5432/knot'
      })
    ).toThrow('DATABASE_URL_MUST_BE_LOCAL_IN_LOCAL')
  })

  it('keeps production closed when GitHub OAuth is missing', () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        APP_ENV: 'production',
        API_HOST: '0.0.0.0'
      })
    ).toThrow('GITHUB_OAUTH_REQUIRED_IN_PRODUCTION')
  })
})
