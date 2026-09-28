import { mkdir } from 'node:fs/promises'

import { ensureArchiveAsset, ensureDirectAsset, modelAssetsOf } from './assets'
import { fail, info } from './log'
import { DOWNLOAD_TMP_DIR, MODELS_DIR } from './paths'

const main = async () => {
  await mkdir(MODELS_DIR, { recursive: true })
  await mkdir(DOWNLOAD_TMP_DIR, { recursive: true })

  const wantsAll = process.argv.includes('--all')
  const wantsSummary = wantsAll || process.argv.includes('--summary')
  const { directAssets, archiveAssets } = modelAssetsOf({ wantsAll, wantsSummary })

  info(`모델을 ${MODELS_DIR} 에 준비합니다.`)
  if (!wantsAll) info('· 비교용 대안 모델(고품질·저사양)은 `--all` 을 줄 때만 받습니다')
  if (!wantsSummary) info('· 요약 모델(2.4GB)은 `--summary` 를 줄 때만 받습니다')

  for (const asset of directAssets) await ensureDirectAsset(asset)
  for (const asset of archiveAssets) await ensureArchiveAsset(asset)

  info('모델 준비 완료')
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error))
})
