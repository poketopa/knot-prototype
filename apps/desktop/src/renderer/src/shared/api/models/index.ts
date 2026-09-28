import type { DownloadModelsRequest } from '@shared/ipc'

/**
 * @description 모델 설치 상태와 선택지를 불러옵니다. 온보딩 진입 여부(`isReady`)와 요약 가능 여부(`isSummaryReady`)를 함께 줍니다.
 * @returns 모델 상태
 * @example
 * const { isReady } = await getModelStatusApi()
 */
export const getModelStatusApi = async () => window.api.models.status()

/**
 * @description 고른 음성 인식 모델과 필수 모델을 내려받습니다. 진행률은 `onModelDownloadProgress`로 오고, 다 받으면 resolve됩니다.
 * @param whisperModelId - 사용자가 고른 음성 인식 모델
 * @returns 다운로드가 끝난 뒤의 모델 상태
 * @example
 * const status = await downloadModelsApi({ whisperModelId: 'turbo-q5' })
 */
export const downloadModelsApi = async ({ whisperModelId }: DownloadModelsRequest) =>
  window.api.models.download({ whisperModelId })

/**
 * @description 요약 모델만 내려받습니다. 온보딩 묶음에 들어가지 않는 선택 모델입니다.
 * @returns 다운로드가 끝난 뒤의 모델 상태
 * @example
 * const status = await downloadSummaryModelApi()
 */
export const downloadSummaryModelApi = async () => window.api.models.downloadSummary()
