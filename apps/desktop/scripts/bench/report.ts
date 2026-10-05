// 여러 장비의 runs.csv를 모아 장비·모델별 중앙값 표를 만든다.
// 사용: pnpm --filter meeting-stt exec tsx scripts/bench/report.ts [결과 폴더...] [--out=report.md]
// 폴더를 주지 않으면 scripts/fixtures/bench/results 아래 전부를 읽는다. quick 실행은 뺀다.
import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { fail, info } from '../log'
import { BENCH_RESULTS_DIR, parseArgs } from './args'
import { median } from './parse'

type Row = Record<string, string>

const readRuns = async (dir: string) => {
  const csvPath = path.join(dir, 'runs.csv')
  if (!existsSync(csvPath)) return []
  const [header, ...lines] = (await readFile(csvPath, 'utf-8')).trim().split(/\r?\n/)
  const columns = header.split(',')
  return lines.map((line) => {
    const values = line.split(',')
    return Object.fromEntries(columns.map((column, index) => [column, values[index] ?? '']))
  })
}

const resultDirsOf = async (targets: string[]) => {
  if (targets.length > 0) return targets.map((target) => path.resolve(target))
  if (!existsSync(BENCH_RESULTS_DIR)) return []
  const names = await readdir(BENCH_RESULTS_DIR)
  return names
    .filter((name) => !name.includes('-quick-'))
    .map((name) => path.join(BENCH_RESULTS_DIR, name))
}

const medianOf = (rows: Row[], column: string) =>
  median(
    rows
      .map((row) => row[column])
      .filter((value) => value !== '')
      .map(Number)
  )

const format = (value: number | null, digits: number) =>
  value === null ? '-' : value.toFixed(digits)

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  const dirs = await resultDirsOf(args.positionals)
  const rows = (await Promise.all(dirs.map(readRuns))).flat().filter((row) => row.exit_code === '0')
  if (rows.length === 0) fail('읽을 성공 측정이 없습니다')

  const groups = new Map<string, Row[]>()
  for (const row of rows) {
    const key = [row.experiment, row.machine, row.backend, row.model].join('|')
    groups.set(key, [...(groups.get(key) ?? []), row])
  }

  const lines = [
    '| 실험 | 장비 | 백엔드 | 모델 | 측정 수 | RTF | 회의 1시간 처리(분) | 최대 메모리(MB) | VRAM(MB) | 전력 범위 | 평균 W | 회의 1시간당 추가 Wh |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |'
  ]
  for (const [key, group] of [...groups.entries()].sort()) {
    const [experiment, machine, backend, model] = key.split('|')
    const rtf = medianOf(group, 'rtf')
    const memory = medianOf(group, 'peak_footprint_mb') ?? medianOf(group, 'max_rss_mb')
    lines.push(
      `| ${experiment} | ${machine} | ${backend} | ${model} | ${group.length} | ${format(rtf, 3)} | ${format(
        rtf === null ? null : rtf * 60,
        1
      )} | ${format(memory, 0)} | ${format(medianOf(group, 'vram_peak_mb'), 0)} | ${group[0].power_scope} | ${format(
        medianOf(group, 'avg_w'),
        1
      )} | ${format(medianOf(group, 'extra_wh_per_audio_h'), 2)} |`
    )
  }

  const notes = [
    '',
    '- 값은 모두 중앙값이다. 실패한 실행은 뺐다.',
    '- 최대 메모리: macOS는 GPU 버퍼를 포함한 peak memory footprint, Windows는 PeakWorkingSet(VRAM 제외).',
    '- 전력 범위: system=맥북 시스템 전체, soc=맥 칩(CPU+GPU+ANE), gpu/gpu+cpu=데스크탑 부품 합. 범위가 다르면 평균 W를 직접 비교하지 않는다.',
    '- 회의 1시간당 추가 Wh = (처리 중 평균 − 유휴 평균) × 처리 시간 ÷ 음성 길이(시간). 장비 간 비교는 이 값으로 한다.'
  ]
  const report = `${lines.join('\n')}\n${notes.join('\n')}\n`
  info(report)

  const outPath = args.text('out')
  if (outPath) {
    await writeFile(path.resolve(outPath), report)
    info(`→ ${path.resolve(outPath)}`)
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error))
})
