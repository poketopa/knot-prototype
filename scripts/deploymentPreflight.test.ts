import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'

import { validateDeploymentConfig } from '../deploy/prototype/preflight.mjs'

const parsed = JSON.parse(
  execFileSync(
    'docker',
    [
      'compose',
      '--env-file',
      '.env.prototype.production.example',
      '-f',
      'compose.ec2.example.yml',
      'config',
      '--format',
      'json'
    ],
    { encoding: 'utf8' }
  )
)

const hostProxyParsed = JSON.parse(
  execFileSync(
    'docker',
    [
      'compose',
      '--env-file',
      '.env.prototype.production.example',
      '-f',
      'compose.ec2.host-proxy.yml',
      'config',
      '--format',
      'json'
    ],
    { encoding: 'utf8' }
  )
)

const validConfig = (source = parsed) => {
  const config = structuredClone(source)
  const runtimePassword = 'a'.repeat(64)
  const migrationPassword = 'b'.repeat(64)
  for (const service of [config.services.api, config.services.migrate]) {
    service.image = 'knot-prototype-api:20260929'
    service.environment.S3_PRIVATE_PREFIX_CONFIRMED = 'true'
    service.environment.S3_PUBLIC_READ_ACKNOWLEDGED = 'false'
    service.environment.GITHUB_CLIENT_ID = 'fixture-client'
    service.environment.GITHUB_CLIENT_SECRET = 'fixture-secret'
  }
  config.services.api.environment.DATABASE_URL = `postgres://knot_api_runtime:${runtimePassword}@postgres:5432/knot_prototype`
  config.services.migrate.environment.MIGRATION_DATABASE_URL = `postgres://knot_migrator:${migrationPassword}@postgres:5432/knot_prototype`
  config.services.migrate.environment.API_RUNTIME_DB_PASSWORD = runtimePassword
  config.services.postgres.environment.POSTGRES_PASSWORD = migrationPassword
  return config
}

describe('offline deployment preflight', () => {
  it('rejects the unconfigured example rather than suggesting it can deploy', () => {
    const errors = validateDeploymentConfig(parsed)
    expect(errors.join('\n')).toContain('S3 비공개 확인 또는 공개 읽기 승인')
    expect(errors.join('\n')).toContain('GITHUB_CLIENT_SECRET')
  })

  it('accepts complete settings without connecting to their destinations', () => {
    expect(validateDeploymentConfig(validConfig())).toEqual([])
  })

  it('accepts host-proxy Compose with only the API loopback port published', () => {
    expect(validateDeploymentConfig(validConfig(hostProxyParsed))).toEqual([])
  })

  it('accepts deliberate public-read S3 mode without private-prefix confirmation', () => {
    const config = validConfig()
    for (const service of [config.services.api, config.services.migrate]) {
      service.environment.S3_PRIVATE_PREFIX_CONFIRMED = 'false'
      service.environment.S3_PUBLIC_READ_ACKNOWLEDGED = 'true'
      service.environment.S3_PREFIX = 'knot/prototype-public/recordings'
    }

    expect(validateDeploymentConfig(config)).toEqual([])
  })

  it('rejects host-proxy Compose when the API port is public', () => {
    const config = validConfig(hostProxyParsed)
    config.services.api.ports[0].host_ip = '0.0.0.0'
    expect(validateDeploymentConfig(config).join('\n')).toContain('127.0.0.1:4310')
  })

  it('rejects host-proxy Compose when PostgreSQL publishes a host port', () => {
    const config = validConfig(hostProxyParsed)
    config.services.postgres.ports = [{ target: 5432, published: '5432', protocol: 'tcp' }]
    expect(validateDeploymentConfig(config).join('\n')).toContain('API loopback 포트 외')
  })

  it('rejects host-proxy Compose when memory limits exceed the EC2 target', () => {
    const config = validConfig(hostProxyParsed)
    config.services.api.mem_limit = String(512 * 1024 * 1024)
    expect(validateDeploymentConfig(config).join('\n')).toContain('API 메모리 제한')
  })

  it.each(['api', 'postgres'])('rejects exposed %s ports', (service) => {
    const config = validConfig()
    config.services[service].ports = [{ target: 5432, published: '5432' }]
    expect(validateDeploymentConfig(config).join('\n')).toContain('호스트 포트')
  })

  it('rejects mixed passwords, missing persistent data, and runtime migrator credentials', () => {
    const config = validConfig()
    config.services.api.environment.MIGRATION_DATABASE_URL = 'secret-never-print'
    config.services.migrate.environment.API_RUNTIME_DB_PASSWORD = 'mismatched-secret'
    config.services.postgres.volumes = []
    const errors = validateDeploymentConfig(config).join('\n')
    expect(errors).toContain('마이그레이션용')
    expect(errors).toContain('일치하지 않습니다')
    expect(errors).toContain('영속')
    expect(errors).not.toContain('secret-never-print')
    expect(errors).not.toContain('mismatched-secret')
  })

  it('rejects unconfirmed privacy, wrong prefix, wrong callback, and implicit startup', () => {
    const config = validConfig()
    config.services.api.environment.S3_PRIVATE_PREFIX_CONFIRMED = 'false'
    config.services.api.environment.S3_PUBLIC_READ_ACKNOWLEDGED = 'false'
    config.services.api.environment.S3_PREFIX = 'other-team/private'
    config.services.api.environment.OAUTH_CALLBACK_URL = 'http://invalid/callback'
    delete config.services.api.command
    const errors = validateDeploymentConfig(config).join('\n')
    expect(errors).toContain('S3 비공개 확인 또는 공개 읽기 승인')
    expect(errors).toContain('Knot 전용')
    expect(errors).toContain('OAuth callback')
    expect(errors).toContain('전용 start')
  })

  it.each([false, true])('does not expose Compose secrets on CLI error=%s', (fail) => {
    const root = mkdtempSync(join(tmpdir(), 'knot-preflight-test-'))
    const fixture = join(root, 'fixture.json')
    const envFile = join(root, 'test.env')
    writeFileSync(fixture, JSON.stringify(validConfig()))
    writeFileSync(envFile, 'FIXTURE_ONLY=true\n')
    const docker = join(root, 'docker')
    writeFileSync(
      docker,
      `#!/bin/sh\nfound_env=0\nfound_config=0\nfor arg in "$@"; do\n  [ "$arg" = "${envFile}" ] && found_env=1\n  [ "$arg" = "config" ] && found_config=1\ndone\n[ "$found_env" = 1 ] && [ "$found_config" = 1 ] || exit 99\nprintf 'sensitive-diagnostic-secret' >&2\ncat "$PREFLIGHT_FIXTURE"\nexit ${fail ? 1 : 0}\n`
    )
    chmodSync(docker, 0o700)
    const result = spawnSync(
      process.execPath,
      ['deploy/prototype/preflight.mjs', '--env-file', envFile],
      {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${root}:${process.env.PATH}`, PREFLIGHT_FIXTURE: fixture }
      }
    )
    expect(result.status).toBe(fail ? 1 : 0)
    const output = result.stdout + result.stderr
    expect(output).not.toContain('sensitive-diagnostic-secret')
    expect(output).not.toContain('fixture-secret')
    expect(output).not.toContain('a'.repeat(64))
    if (!fail) expect(output).toContain('별도로 검증')
  })

  it('passes the selected Compose file to docker config without exposing secrets on success', () => {
    const root = mkdtempSync(join(tmpdir(), 'knot-preflight-compose-file-test-'))
    const fixture = join(root, 'fixture.json')
    const envFile = join(root, 'test.env')
    const composeFile = join(root, 'host-proxy.yml')
    writeFileSync(fixture, JSON.stringify(validConfig(hostProxyParsed)))
    writeFileSync(envFile, 'FIXTURE_ONLY=true\n')
    writeFileSync(composeFile, 'services: {}\n')
    const docker = join(root, 'docker')
    writeFileSync(
      docker,
      `#!/bin/sh\nfound_compose=0\nfor arg in "$@"; do\n  [ "$arg" = "${composeFile}" ] && found_compose=1\ndone\n[ "$found_compose" = 1 ] || exit 99\ncat "$PREFLIGHT_FIXTURE"\n`
    )
    chmodSync(docker, 0o700)

    const result = spawnSync(
      process.execPath,
      ['deploy/prototype/preflight.mjs', '--env-file', envFile, '--compose-file', composeFile],
      {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${root}:${process.env.PATH}`, PREFLIGHT_FIXTURE: fixture }
      }
    )

    expect(result.status).toBe(0)
    const output = result.stdout + result.stderr
    expect(output).toContain('오프라인 배포 설정 점검 통과')
    expect(output).not.toContain('fixture-secret')
    expect(output).not.toContain('a'.repeat(64))
  })
})
