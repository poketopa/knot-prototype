import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const appPath = resolve(process.argv[2] ?? 'dist/mac-arm64/Knot Meeting Prototype.app')

if (process.platform !== 'darwin' || !existsSync(appPath)) {
  console.error('macOS에서 빌드된 앱 경로를 지정하세요.')
  process.exit(1)
}

// A runnable local Electron binary does not prove downloaded-app acceptance.
const checks = [
  ['codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]],
  ['xcrun', ['stapler', 'validate', appPath]],
  ['spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath]]
]

for (const [command, args] of checks) {
  const result = spawnSync(command, args, { stdio: 'inherit', timeout: 120_000 })
  if (result.error || result.status !== 0) {
    console.error(`${command} 검증 실패: 이 앱을 배포하지 마세요.`)
    process.exit(1)
  }
}

console.log('서명·공증 티켓·Gatekeeper 검증 통과')
