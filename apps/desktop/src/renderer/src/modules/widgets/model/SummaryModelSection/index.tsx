import SettingRow from '@renderer/shared/components/primitives/layout/SettingRow'
import Button from '@renderer/shared/components/primitives/ui/Button'
import ProgressBar from '@renderer/shared/components/primitives/ui/ProgressBar'
import useModelStatus from '@renderer/shared/hooks/domain/model/useModelStatus'
import { formatBytes } from '@renderer/shared/utils/formatBytes'

import styles from './index.module.css'

interface SummaryModelSectionProps {
  isDisabled?: boolean
}

/**
 * 로컬 실행 방식의 요약 모델 파일. 온보딩 묶음에 없어 설정의 "요약 · 용어 초안" 카테고리에서 로컬을
 * 골랐을 때만 보이고, Claude를 쓰면 필요 없다 (references/distribution.md 1절, architecture.md "LLM 공급자").
 */
export default function SummaryModelSection({ isDisabled = false }: SummaryModelSectionProps) {
  const { status, isLoading, error, progress, isDownloading, downloadError, downloadSummaryModel } =
    useModelStatus()

  if (isLoading && !status) return <p className={styles.message}>모델 상태를 확인하는 중입니다</p>
  if (!status) {
    return (
      <p className={styles.error} role="alert">
        {error?.message ?? '모델 상태를 확인하지 못했습니다'}
      </p>
    )
  }

  const item = status.items.find((candidate) => candidate.key === 'summary')
  if (!item) return null

  const percent = progress.summary?.percent ?? 0

  const size = formatBytes({ bytes: item.sizeBytes })

  const renderControl = () => {
    if (isDownloading) return <span className={styles.meta}>{percent}%</span>
    if (item.isInstalled) return <span className={styles.success}>설치되어 있습니다</span>

    return (
      <Button onClick={downloadSummaryModel} disabled={isDisabled}>
        모델 파일 받기
      </Button>
    )
  }

  return (
    <SettingRow
      title={
        <>
          로컬 요약 모델 파일 <span className={styles.optional}>로컬 방식에만 필요</span>
        </>
      }
      description={
        <>
          {item.isInstalled ? '설치됨' : `설치되지 않음 · ${size}`}. 이 기기에서 요약·용어 초안을
          만들 때 쓰는 모델 파일입니다. Codex CLI나 Claude Code를 고르면 필요 없습니다.
          {downloadError && (
            <span className={styles.error} role="alert">
              {' '}
              {downloadError.message}
            </span>
          )}
        </>
      }
      control={renderControl()}
    >
      {isDownloading ? <ProgressBar percent={percent} label="요약 모델 다운로드 진행률" /> : null}
    </SettingRow>
  )
}
