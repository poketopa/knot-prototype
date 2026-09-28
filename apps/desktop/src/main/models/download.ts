import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs'
import { copyFile, mkdir, rename, rm, truncate } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { runBinary } from '../bin/spawn'
import { messageOf } from '../log'
import type { ModelAsset } from '@meeting-stt/models/desktop'

const HTTP_PARTIAL_CONTENT = 206
const TMP_DIR_NAME = 'tmp'

export interface ModelDownloadProgress {
  key: ModelAsset['key']
  receivedBytes: number
  totalBytes: number
}

interface DownloadModelAssetParams {
  asset: ModelAsset
  modelsDir: string
  onProgress: (progress: ModelDownloadProgress) => void
}

const sha256Of = async (filePath: string) => {
  const hash = createHash('sha256')
  await pipeline(createReadStream(filePath), hash)

  return hash.digest('hex')
}

interface FetchToFileParams {
  url: string
  destPath: string
  sha256: string
  expectedBytes: number
  onProgress: (received: { receivedBytes: number; totalBytes: number }) => void
}

/**
 * Range 이어받기 + SHA256 검증. 검증에 실패하면 파일을 지워 다음 시도가 처음부터 받게 한다.
 * 부분 파일은 tmp에 두므로 완료 전까지 모델이 설치된 것처럼 보이지 않는다 (`references/distribution.md`).
 */
const fetchToFile = async ({
  url,
  destPath,
  sha256,
  expectedBytes,
  onProgress
}: FetchToFileParams) => {
  const downloadedBytes = existsSync(destPath) ? statSync(destPath).size : 0
  const headers: Record<string, string> = {}
  if (downloadedBytes > 0) headers.Range = `bytes=${downloadedBytes}-`

  const response = await fetch(url, { headers })
  if (!response.ok || !response.body) {
    throw new Error(
      `모델을 내려받지 못했습니다 (HTTP ${response.status}). 네트워크를 확인해 주세요`
    )
  }

  // 서버가 Range를 무시하면 전체 본문이 오므로 처음부터 다시 쓴다
  const isResumed = downloadedBytes > 0 && response.status === HTTP_PARTIAL_CONTENT
  if (downloadedBytes > 0 && !isResumed) await truncate(destPath, 0)

  const alreadyDone = isResumed ? downloadedBytes : 0
  const remaining = Number(response.headers.get('content-length') ?? 0)
  const totalBytes = Math.max(alreadyDone + remaining, expectedBytes)
  let receivedBytes = alreadyDone

  const reader = response.body.getReader()
  const chunks = async function* () {
    for (;;) {
      const { done, value } = await reader.read()
      if (done || !value) return

      receivedBytes += value.byteLength
      onProgress({ receivedBytes, totalBytes })
      yield value
    }
  }

  await pipeline(chunks(), createWriteStream(destPath, { flags: isResumed ? 'a' : 'w' }))

  if ((await sha256Of(destPath)) !== sha256) {
    await rm(destPath, { force: true })
    throw new Error('내려받은 파일이 손상되었습니다. 다시 시도해 주세요')
  }
}

interface ExtractEntryParams {
  archivePath: string
  entry: string
  destPath: string
}

/** bsdtar는 확장자로 압축 방식을 판별한다. macOS와 Windows 10 1803+에 기본 포함돼 있다 */
const extractEntry = async ({ archivePath, entry, destPath }: ExtractEntryParams) => {
  const extractDir = `${archivePath}.extracted`
  await rm(extractDir, { recursive: true, force: true })
  await mkdir(extractDir, { recursive: true })

  try {
    await runBinary({ command: 'tar', args: ['-xf', archivePath, '-C', extractDir] })
  } catch (caught) {
    throw new Error(`압축을 풀지 못했습니다: ${messageOf(caught)}`)
  }

  await copyFile(path.join(extractDir, entry), destPath)
  await rm(extractDir, { recursive: true, force: true })
}

/**
 * 모델 파일 하나를 userData/models에 놓는다. 이미 있으면 아무것도 하지 않는다 —
 * 수백 MB짜리 파일의 체크섬을 앱을 켤 때마다 다시 읽지 않기 위해서다.
 */
export const downloadModelAsset = async ({
  asset,
  modelsDir,
  onProgress
}: DownloadModelAssetParams) => {
  const destPath = path.join(modelsDir, asset.fileName)
  if (existsSync(destPath)) {
    onProgress({
      key: asset.key,
      receivedBytes: asset.downloadBytes,
      totalBytes: asset.downloadBytes
    })

    return destPath
  }

  const tmpDir = path.join(modelsDir, TMP_DIR_NAME)
  await mkdir(tmpDir, { recursive: true })

  const downloadName = asset.kind === 'archive' ? asset.archiveName : asset.fileName
  const partPath = path.join(tmpDir, `${downloadName}.part`)

  await fetchToFile({
    url: asset.url,
    destPath: partPath,
    sha256: asset.sha256,
    expectedBytes: asset.downloadBytes,
    onProgress: ({ receivedBytes, totalBytes }) =>
      onProgress({ key: asset.key, receivedBytes, totalBytes })
  })

  if (asset.kind === 'archive') {
    await extractEntry({ archivePath: partPath, entry: asset.entry, destPath })
    await rm(partPath, { force: true })
  } else {
    await rename(partPath, destPath)
  }

  return destPath
}
