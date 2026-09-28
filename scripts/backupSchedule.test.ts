import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const servicePath = 'deploy/prototype/systemd/knot-prototype-backup.service'
const timerPath = 'deploy/prototype/systemd/knot-prototype-backup.timer'
const readmePath = 'deploy/prototype/systemd/README.md'
const restoreGuidancePath = 'deploy/prototype/restore-guidance.md'

const service = readFileSync(servicePath, 'utf8')
const timer = readFileSync(timerPath, 'utf8')
const readme = readFileSync(readmePath, 'utf8')
const restoreGuidance = readFileSync(restoreGuidancePath, 'utf8')

describe('prototype backup systemd schedule', () => {
  it('runs the existing local backup script from the deployment directory as a oneshot service', () => {
    expect(service).toContain('Type=oneshot')
    expect(service).toContain('WorkingDirectory=/opt/knot-prototype')
    expect(service).toContain('UMask=0077')
    expect(service).toContain('ExecStart=/opt/knot-prototype/deploy/prototype/backup-postgres.sh')
    expect(service).not.toMatch(/Environment=.*(POSTGRES_PASSWORD|GITHUB_CLIENT_SECRET|AWS_)/)
    expect(service).not.toMatch(/aws\s+s3|s3:\/\//)
  })

  it('schedules one daily run at 03:00 KST as explicit UTC 18:00 and catches missed runs', () => {
    expect(timer).toContain('OnCalendar=*-*-* 18:00:00 UTC')
    expect(timer).toContain('03:00 Asia/Seoul')
    expect(timer).toContain('Persistent=true')
    expect(timer).toContain('Unit=knot-prototype-backup.service')
    expect(timer).toContain('WantedBy=timers.target')
  })

  it('documents local-only behavior and delayed enablement until manual verification', () => {
    expect(readme).toContain('로컬 PostgreSQL dump만')
    expect(readme).toContain('S3 업로드')
    expect(readme).toContain('원격 백업이 준비됐다고 해석하면 안 된다')
    expect(readme).toContain('수동으로 백업을 한 번 실행')
    expect(readme).toContain('위 검증 전에는 timer를 enable하지 않는 것을 권장')
    expect(restoreGuidance).toContain('첫 수동 백업과 checksum 검증')
    expect(restoreGuidance).toContain('S3 업로드를 하지 않고')
  })

  it.skipIf(
    !systemdAnalyzeExists() ||
      !existsSync('/opt/knot-prototype/deploy/prototype/backup-postgres.sh')
  )('has unit files accepted by systemd-analyze on the prepared Linux host', () => {
    expect(() => execFileSync('systemd-analyze', ['verify', servicePath, timerPath])).not.toThrow()
  })
})

function systemdAnalyzeExists() {
  const path = process.env.PATH ?? ''
  return path.split(':').some((dir) => existsSync(`${dir}/systemd-analyze`))
}
