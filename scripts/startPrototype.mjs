import { spawn, spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const context = 'desktop-linux'
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} 실행 실패 (${result.status})`)
  return result
}
const capture = (args) => {
  const result = spawnSync('docker', args, { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) return null
  return result.stdout.trim()
}
const endpoint = capture(['context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}'])
if (!endpoint?.startsWith('unix://'))
  throw new Error('로컬 Docker Desktop unix socket만 사용할 수 있습니다.')
if (!capture(['--context', context, 'info', '--format', '{{.OSType}}'])) {
  run('open', ['-a', 'Docker'])
  let ready = false
  for (let i = 0; i < 45; i++) {
    await new Promise((done) => setTimeout(done, 1000))
    if (capture(['--context', context, 'info', '--format', '{{.OSType}}'])) {
      ready = true
      break
    }
  }
  if (!ready)
    throw new Error('Docker Desktop이 준비되지 않았습니다. Docker 창의 상태를 확인해 주세요.')
}
const envPath = resolve(root, '.env.prototype.local')
if (!existsSync(envPath))
  writeFileSync(envPath, 'GITHUB_CLIENT_ID=\nGITHUB_CLIENT_SECRET=\n', { mode: 0o600 })
run('docker', [
  '--context',
  context,
  'compose',
  '--env-file',
  envPath,
  '-p',
  'knot-prototype-local',
  '-f',
  'compose.local.yml',
  'up',
  '-d',
  '--build'
])
let apiReady = false
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    const response = await fetch('http://127.0.0.1:4310/health', {
      signal: AbortSignal.timeout(1000)
    })
    if (response.ok) {
      apiReady = true
      break
    }
  } catch {
    /* API startup may still be applying local migrations. */
  }
  await new Promise((resolve) => setTimeout(resolve, 1000))
}
if (!apiReady)
  throw new Error('로컬 API가 준비되지 않았습니다. prototype:status와 Docker 로그를 확인해 주세요.')
console.log('로컬 서버: http://127.0.0.1:4310 · AWS 접근 없음')
if (process.argv.includes('--server-only')) {
  console.log('서버 준비 완료')
} else if (process.argv.includes('--dev')) {
  const child = spawn('corepack', ['pnpm', '--filter', 'meeting-stt', 'dev'], {
    cwd: root,
    stdio: 'inherit'
  })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
  child.on('error', (error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  child.on('exit', (code) => {
    process.exitCode = code ?? 0
  })
} else {
  run('corepack', ['pnpm', 'build:unpack'], {
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
  })
  run('open', [resolve(root, 'apps/desktop/dist/mac-arm64/Knot Meeting Prototype.app')])
}
