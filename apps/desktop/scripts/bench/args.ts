import path from 'node:path'

import { BIN_DIR, FIXTURES_DIR } from '../paths'

export const BENCH_DIR = path.join(FIXTURES_DIR, 'bench')
export const BENCH_AUDIO_DIR = path.join(BENCH_DIR, 'audio')
export const BENCH_RESULTS_DIR = path.join(BENCH_DIR, 'results')

const EXE_SUFFIX = process.platform === 'win32' ? '.exe' : ''
export const DEFAULT_WHISPER_BIN = path.join(BIN_DIR, `whisper-cli${EXE_SUFFIX}`)

/**
 * `--이름=값`과 `--플래그`만 받는다. 값 앞의 공백 구분을 허용하지 않아 파일 경로와 헷갈리지 않는다.
 * pnpm이 넘기는 `--` 구분자는 무시한다.
 */
export const parseArgs = (argv: string[]) => {
  const flags = new Map<string, string>()
  const positionals: string[] = []

  for (const arg of argv) {
    if (arg === '--') continue
    if (!arg.startsWith('--')) {
      positionals.push(arg)
      continue
    }
    const separator = arg.indexOf('=')
    if (separator < 0) flags.set(arg.slice(2), 'true')
    else flags.set(arg.slice(2, separator), arg.slice(separator + 1))
  }

  return {
    positionals,
    text: (name: string) => flags.get(name),
    has: (name: string) => flags.get(name) === 'true',
    number: (name: string, fallback: number) => {
      const value = flags.get(name)
      if (value === undefined) return fallback
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) throw new Error(`--${name} 값이 숫자가 아닙니다: ${value}`)
      return parsed
    },
    list: (name: string) =>
      (flags.get(name) ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
  }
}

/** 결과 폴더 이름용 현지 시각 (20261005T1403) */
export const stampOf = (date = new Date()) => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}`
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
