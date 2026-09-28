import type { ModelStatusItem, ModelStatusResponse } from '@shared/ipc'
import type { WhisperModelId } from '@shared/types'

interface DownloadPlanParams {
  status: ModelStatusResponse
  selectedId: WhisperModelId
}

/** 화면에 보여 줄 항목 하나. 다른 whisper 모델을 고르면 그 모델이 whisper 자리에 들어간다 */
export interface PlannedItem {
  key: ModelStatusItem['key']
  label: string
  sizeBytes: number
  isInstalled: boolean
}

/**
 * 온보딩·설정이 실제로 받게 될 목록. 필수 모델 + 고른 whisper 모델이며, 요약 모델은 들어가지 않는다.
 * 현재 선택과 다른 whisper 모델은 설치 여부를 모르므로 받아야 하는 것으로 본다 (references/distribution.md 3절).
 */
export const planDownload = ({ status, selectedId }: DownloadPlanParams) => {
  const option = status.whisperOptions.find((candidate) => candidate.id === selectedId)
  const isCurrentSelection = selectedId === status.selectedWhisperModelId

  const items: PlannedItem[] = status.items
    .filter((item) => item.isRequired)
    .map((item) =>
      item.key === 'whisper'
        ? {
            key: item.key,
            label: `음성 인식 모델 (${option?.label ?? item.label})`,
            sizeBytes: option?.sizeBytes ?? item.sizeBytes,
            isInstalled: isCurrentSelection && item.isInstalled
          }
        : {
            key: item.key,
            label: item.label,
            sizeBytes: item.sizeBytes,
            isInstalled: item.isInstalled
          }
    )

  const bytesToDownload = items
    .filter((item) => !item.isInstalled)
    .reduce((total, item) => total + item.sizeBytes, 0)

  return { items, bytesToDownload }
}
