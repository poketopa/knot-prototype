import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const isPlaceholder = (value) => !value || /replace|example|placeholder|change-me/i.test(value)

const isPublicDomain = (value) => {
  try {
    const url = new URL(`https://${value}`)
    return (
      url.hostname === value &&
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(value) &&
      !/\.(local|localhost|example|invalid)$/.test(value) &&
      !/^[\d.]+$/.test(value)
    )
  } catch {
    return false
  }
}

const checkEnvironment = ({ api, caddy, errors }) => {
  const env = api.environment ?? {}
  const domain = caddy.environment?.KNOT_API_DOMAIN
  if (!isPublicDomain(domain)) errors.push('실제 API 도메인을 지정해야 합니다.')
  if (env.APP_ENV !== 'production' || env.STORAGE_DRIVER !== 's3') {
    errors.push('운영 환경은 APP_ENV=production, STORAGE_DRIVER=s3여야 합니다.')
  }
  if (String(env.S3_PRIVATE_PREFIX_CONFIRMED) !== 'true') {
    errors.push('S3 비공개 경로의 관리자 확인과 접근 검증이 아직 필요합니다.')
  }
  if (!/^knot\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(env.S3_PREFIX ?? '')) {
    errors.push('S3_PREFIX는 Knot 전용 하위 경로여야 합니다.')
  }
  for (const key of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'AWS_REGION', 'S3_BUCKET']) {
    if (isPlaceholder(env[key])) errors.push(`${key}의 실제 설정이 필요합니다.`)
  }
  if (env.OAUTH_CALLBACK_URL !== `https://${domain}/v1/auth/github/callback`) {
    errors.push('OAuth callback이 API 도메인의 HTTPS callback과 일치해야 합니다.')
  }
  if (env.MIGRATION_DATABASE_URL || env.POSTGRES_PASSWORD || env.API_RUNTIME_DB_PASSWORD) {
    errors.push('API 환경에 마이그레이션용 또는 불필요한 DB 비밀값이 포함되어 있습니다.')
  }
}

const checkDatabase = ({ api, migrate, postgres, errors }) => {
  try {
    const runtime = new URL(api.environment?.DATABASE_URL)
    const migration = new URL(migrate.environment?.MIGRATION_DATABASE_URL)
    if (
      runtime.protocol !== 'postgres:' ||
      migration.protocol !== 'postgres:' ||
      runtime.hostname !== 'postgres' ||
      migration.hostname !== 'postgres' ||
      runtime.pathname !== '/knot_prototype' ||
      migration.pathname !== runtime.pathname ||
      runtime.username !== 'knot_api_runtime' ||
      migration.username !== 'knot_migrator' ||
      isPlaceholder(runtime.password) ||
      isPlaceholder(migration.password) ||
      runtime.password === migration.password
    )
      errors.push('DB 주소·역할·서로 다른 실제 비밀번호를 확인해야 합니다.')
    if (
      decodeURIComponent(runtime.password) !== migrate.environment?.API_RUNTIME_DB_PASSWORD ||
      decodeURIComponent(migration.password) !== postgres.environment?.POSTGRES_PASSWORD
    )
      errors.push('DB 초기화 비밀번호와 접속 URL이 일치하지 않습니다.')
  } catch {
    errors.push('DB 접속 URL을 해석할 수 없습니다. 비밀번호 URL 인코딩을 확인하세요.')
  }
}

const checkNetwork = ({ services, caddy, errors }) => {
  for (const [name, service] of Object.entries(services)) {
    if (service.network_mode === 'host') errors.push('호스트 네트워크 모드는 허용하지 않습니다.')
    if (name !== 'caddy' && service.ports?.length)
      errors.push('프록시 외 서비스의 호스트 포트가 공개되어 있습니다.')
  }
  const ports = caddy.ports ?? []
  if (
    ports.length !== 2 ||
    ![80, 443].every((port) =>
      ports.some(
        (item) =>
          Number(item.target) === port && Number(item.published) === port && item.protocol === 'tcp'
      )
    )
  )
    errors.push('프록시는 TCP 80과 443만 공개해야 합니다.')
}

export const validateDeploymentConfig = (config) => {
  const errors = []
  const { api, migrate, postgres, caddy } = config.services ?? {}
  if (!api || !migrate || !postgres || !caddy) return ['필수 Compose 서비스가 없습니다.']
  checkEnvironment({ api, caddy, errors })
  checkDatabase({ api, migrate, postgres, errors })
  checkNetwork({ services: config.services, caddy, errors })
  if (
    isPlaceholder(api.image) ||
    /:latest$/.test(api.image) ||
    !/:[^/]+$|@sha256:/.test(api.image)
  ) {
    errors.push('API 이미지의 실제 버전 태그 또는 digest를 지정해야 합니다.')
  }
  if (api.image !== migrate.image || api.platform !== 'linux/arm64') {
    errors.push('API와 마이그레이션은 동일한 ARM64 이미지를 사용해야 합니다.')
  }
  if (api.depends_on?.migrate?.condition !== 'service_completed_successfully') {
    errors.push('API 시작 전에 마이그레이션 성공을 기다려야 합니다.')
  }
  if (
    JSON.stringify(api.command) !==
    JSON.stringify(['corepack', 'pnpm', '--filter', '@meeting-stt/api', 'run', 'start'])
  ) {
    errors.push('API는 마이그레이션 대신 전용 start 명령으로 실행해야 합니다.')
  }
  if (
    !postgres.volumes?.some(
      (volume) =>
        volume.type === 'volume' &&
        volume.target === '/var/lib/postgresql/data' &&
        !volume.read_only
    )
  ) {
    errors.push('PostgreSQL 데이터의 영속 Docker 볼륨이 필요합니다.')
  }
  return errors
}

const readComposeConfig = (envFile) => {
  // Compose 출력에는 비밀번호가 있으므로 전체 출력·오류를 전달하지 않는다.
  const result = spawnSync(
    'docker',
    [
      'compose',
      '--env-file',
      envFile,
      '-f',
      'compose.ec2.example.yml',
      'config',
      '--format',
      'json'
    ],
    { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 }
  )
  if (result.status !== 0 || result.error) {
    throw new Error('COMPOSE_CONFIG_FAILED')
  }
  return JSON.parse(result.stdout)
}

export const runPreflight = (args) => {
  if (args.length && (args.length !== 2 || args[0] !== '--env-file')) {
    process.stderr.write('사용법: node deploy/prototype/preflight.mjs [--env-file 파일]\n')
    return 1
  }
  const envFile = args[1] ?? '.env.prototype.production'
  if (!existsSync(envFile)) {
    process.stderr.write('운영 환경 파일이 없습니다. 예시 파일을 참고해 준비하세요.\n')
    return 1
  }
  try {
    const errors = validateDeploymentConfig(readComposeConfig(envFile))
    if (errors.length) {
      process.stderr.write(errors.map((error) => `- ${error}\n`).join(''))
      return 1
    }
  } catch {
    process.stderr.write(
      'Compose 설정을 해석하지 못했습니다. Docker Compose와 필수 환경 변수를 확인하세요.\n'
    )
    return 1
  }
  process.stdout.write(
    '오프라인 배포 설정 점검 통과.\nDNS·TLS·S3 권한·기존 서비스 보존·원격 백업은 별도로 검증해야 합니다.\n'
  )
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runPreflight(process.argv.slice(2))
}
