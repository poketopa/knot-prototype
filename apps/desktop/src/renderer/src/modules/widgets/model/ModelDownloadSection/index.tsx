import { useState } from 'react'
import type { WhisperModelId } from '@shared/types'
import SettingRow from '@renderer/shared/components/primitives/layout/SettingRow'
import Button from '@renderer/shared/components/primitives/ui/Button'
import useModelStatus from '@renderer/shared/hooks/domain/model/useModelStatus'
import { formatBytes } from '@renderer/shared/utils/formatBytes'

import DownloadItemList from './ui/DownloadItemList'
import ModelOption from './ui/ModelOption'
import { planDownload } from './utils/downloadPlan'
import styles from './index.module.css'

/** 저사양 판정일 때 권장되는 모델. 이보다 큰 모델을 고르면 안내만 한다 (references/distribution.md 4절) */
const LOW_SPEC_MODEL_ID: WhisperModelId = 'small-q5_1'

interface ModelDownloadSectionProps {
  /** 다운로드가 끝났을 때. 온보딩은 홈으로 이동하고, 설정은 넘기지 않는다 */
  onComplete?: () => void
  /** 설정에서는 현재 모델 한 행으로 접어 두고 "모델 바꾸기"로 펼친다 (references/architecture.md "화면별 구성") */
  variant?: 'onboarding' | 'setting'
}

/** 온보딩과 설정이 함께 쓰는 음성 인식 모델 선택·다운로드 (references/distribution.md 2절) */
export default function ModelDownloadSection({
  onComplete,
  variant = 'onboarding'
}: ModelDownloadSectionProps) {
  const {
    status,
    isLoading,
    error,
    refetch,
    progress,
    isDownloading,
    downloadError,
    downloadModels
  } = useModelStatus()
  const [chosenId, setChosenId] = useState<WhisperModelId | null>(null)
  const [isCompleted, setIsCompleted] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)

  if (isLoading && !status) return <p className={styles.message}>모델 상태를 확인하는 중입니다</p>
  if (!status) {
    return (
      <div className={styles.failure}>
        <p className={styles.error} role="alert">
          {error?.message ?? '모델 상태를 확인하지 못했습니다'}
        </p>
        <Button variant="secondary" onClick={refetch}>
          다시 시도
        </Button>
      </div>
    )
  }

  // 처음 설정이면 권장 모델을, 이미 쓰고 있으면 현재 모델을 미리 골라 둔다
  const selectedId =
    chosenId ?? (status.isReady ? status.selectedWhisperModelId : status.recommendedWhisperModelId)
  const { items, bytesToDownload } = planDownload({ status, selectedId })
  const isLowSpecWarning =
    status.recommendedWhisperModelId === LOW_SPEC_MODEL_ID && selectedId !== LOW_SPEC_MODEL_ID
  const isAlreadyApplied =
    status.isReady && selectedId === status.selectedWhisperModelId && bytesToDownload === 0

  const handleDownload = async () => {
    setIsCompleted(false)
    if (isAlreadyApplied) {
      setIsCompleted(true)
      onComplete?.()
      return
    }

    const isSucceeded = await downloadModels({ whisperModelId: selectedId })
    if (!isSucceeded) return

    setIsCompleted(true)
    onComplete?.()
  }

  const buttonLabel = () => {
    if (isDownloading) return '받는 중…'
    if (bytesToDownload > 0) return `다운로드 (${formatBytes({ bytes: bytesToDownload })})`

    return '이 모델 사용'
  }

  const renderStatusNote = () => {
    if (isCompleted) return <span className={styles.success}>모델이 준비되었습니다</span>
    if (isDownloading) return <span className={styles.message}>받는 중에 창을 닫지 마세요</span>
    if (isAlreadyApplied) return <span className={styles.message}>현재 사용 중인 모델입니다</span>

    return (
      <span className={styles.message}>
        음성 인식은 이 컴퓨터에서 실행합니다. 로그인과 자료 보관은 연결된 서버를 쓰고, 외부 AI를
        고르면 정리 단계에서 회의록이 해당 AI 서버로 전송될 수 있습니다.
      </span>
    )
  }

  const picker = (
    <div className={styles.picker}>
      <fieldset className={styles.options}>
        <legend className={styles.legend}>음성 인식 모델 선택</legend>
        {status.whisperOptions.map((option) => (
          <ModelOption
            key={option.id}
            option={option}
            isSelected={option.id === selectedId}
            isRecommended={option.id === status.recommendedWhisperModelId}
            isDisabled={isDownloading}
            onSelect={() => {
              setChosenId(option.id)
              setIsCompleted(false)
            }}
          />
        ))}
      </fieldset>

      {isLowSpecWarning && (
        <p className={styles.warning}>
          이 컴퓨터 사양에서는 처리 시간이 오래 걸릴 수 있습니다. 권장 모델은 저사양용입니다.
        </p>
      )}

      <DownloadItemList items={items} progress={progress} isDownloading={isDownloading} />

      <div className={styles.actions}>
        {renderStatusNote()}
        <Button
          onClick={handleDownload}
          disabled={isDownloading || (isAlreadyApplied && !onComplete)}
        >
          {buttonLabel()}
        </Button>
      </div>

      {downloadError && (
        <p className={styles.error} role="alert">
          {downloadError.message}
        </p>
      )}
    </div>
  )

  if (variant === 'onboarding') {
    return (
      <section className={styles.section} aria-label="음성 인식 모델">
        {picker}
      </section>
    )
  }

  const currentLabel =
    status.whisperOptions.find((option) => option.id === status.selectedWhisperModelId)?.label ??
    status.selectedWhisperModelId

  return (
    <SettingRow
      title="음성 인식 모델"
      description={`${currentLabel} · ${status.isReady ? '설치됨' : '설치되지 않음'}`}
      control={
        <Button
          variant="secondary"
          aria-expanded={isExpanded}
          disabled={isDownloading && isExpanded}
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? '닫기' : '모델 바꾸기'}
        </Button>
      }
    >
      {isExpanded ? picker : null}
    </SettingRow>
  )
}
