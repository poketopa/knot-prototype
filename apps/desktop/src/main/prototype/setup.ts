import type { SetupStatusResponse } from '@shared/ipc'
import { INITIAL_SETUP_PROVIDERS } from '@shared/llm'
import { getDb } from '../db/connection'
import { getLlmProvider } from '../db/settings'
import { checkLlm } from '../llm/check'
import { modelStatus } from '../models/service'
import { requirePrototypeUser } from './authState'

const SETUP_COMPLETED_KEY = 'setup.completed'

/** 설치한 기기의 로그인 사용자별 최초 설정 완료 상태. */
export const getSetupStatus = (): SetupStatusResponse => {
  requirePrototypeUser()
  const row = getDb()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(SETUP_COMPLETED_KEY) as { value: string } | undefined
  return { isComplete: row?.value === 'true' }
}

/** 파일과 선택한 AI 연결이 모두 준비됐을 때만 최초 설정을 완료한다. */
export const completeSetup = async (): Promise<SetupStatusResponse> => {
  const ownerId = requirePrototypeUser().id
  const models = modelStatus()
  if (!models.isReady) throw new Error('음성 인식 모델 다운로드를 먼저 완료해 주세요')
  const provider = getLlmProvider()
  if (!INITIAL_SETUP_PROVIDERS.includes(provider)) {
    throw new Error('로컬 모델, Codex CLI 또는 Claude Code 중 실행 방식을 선택해 주세요')
  }
  await checkLlm()
  if (requirePrototypeUser().id !== ownerId) {
    throw new Error('로그인 계정이 변경되었습니다. 다시 확인해 주세요')
  }
  const currentModels = modelStatus()
  if (
    getLlmProvider() !== provider ||
    !currentModels.isReady ||
    currentModels.selectedWhisperModelId !== models.selectedWhisperModelId
  ) {
    throw new Error('모델 설정이 변경되었습니다. 다시 확인해 주세요')
  }
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, 'true')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(SETUP_COMPLETED_KEY)
  return { isComplete: true }
}
