import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs'
import { mkdir, rm, truncate } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import { formatMb, info } from './log'

const PROGRESS_LOG_INTERVAL_MS = 700
const HTTP_PARTIAL_CONTENT = 206

export const sha256Of = async (filePath: string) => {
  const hash = createHash('sha256')
  await pipeline(createReadStream(filePath), hash)
  return hash.digest('hex')
}

interface DownloadFileParams {
  url: string
  destPath: string
  sha256: string
  label: string
}

/**
 * 이어받기(Range)와 SHA256 검증을 지원하는 다운로더.
 * 이미 올바른 파일이 있으면 네트워크를 쓰지 않는다.
 */
export const downloadFile = async ({ url, destPath, sha256, label }: DownloadFileParams) => {
  await mkdir(path.dirname(destPath), { recursive: true })

  if (existsSync(destPath) && (await sha256Of(destPath)) === sha256) {
    info(`· ${label} 이미 준비됨`)
    return destPath
  }

  const downloadedBytes = existsSync(destPath) ? statSync(destPath).size : 0
  const headers: Record<string, string> = {}
  if (downloadedBytes > 0) headers.Range = `bytes=${downloadedBytes}-`

  const response = await fetch(url, { headers })
  if (!response.ok || !response.body) {
    throw new Error(`${label} 다운로드 실패 (HTTP ${response.status}): ${url}`)
  }

  // 서버가 Range를 무시하면 전체 본문이 오므로 처음부터 다시 쓴다.
  const isResumed = downloadedBytes > 0 && response.status === HTTP_PARTIAL_CONTENT
  if (downloadedBytes > 0 && !isResumed) await truncate(destPath, 0)

  const alreadyDone = isResumed ? downloadedBytes : 0
  const remaining = Number(response.headers.get('content-length') ?? 0)
  const totalBytes = alreadyDone + remaining

  let receivedBytes = alreadyDone
  let lastLoggedAt = 0
  const reader = response.body.getReader()

  const chunks = async function* () {
    for (;;) {
      const { done, value } = await reader.read()
      if (done || !value) return

      receivedBytes += value.byteLength
      const now = performance.now()
      if (now - lastLoggedAt >= PROGRESS_LOG_INTERVAL_MS) {
        lastLoggedAt = now
        const ratio = totalBytes > 0 ? ` (${Math.round((receivedBytes / totalBytes) * 100)}%)` : ''
        info(`· ${label} ${formatMb(receivedBytes)}${ratio}`)
      }

      yield value
    }
  }

  await pipeline(chunks(), createWriteStream(destPath, { flags: isResumed ? 'a' : 'w' }))

  const actual = await sha256Of(destPath)
  if (actual !== sha256) {
    await rm(destPath, { force: true })
    throw new Error(`${label} 체크섬 불일치 — 기대 ${sha256}, 실제 ${actual}. 다시 실행해 주세요`)
  }

  info(`· ${label} 완료 ${formatMb(receivedBytes)}`)
  return destPath
}
