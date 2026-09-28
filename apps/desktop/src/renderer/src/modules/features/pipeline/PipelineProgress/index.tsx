import ProgressBar from '@renderer/shared/components/primitives/ui/ProgressBar'
import usePipelineProgress from '@renderer/shared/hooks/domain/pipeline/usePipelineProgress'

import { PIPELINE_STAGE_LABELS, PIPELINE_WAITING_LABEL } from './constants/stageLabels'
import styles from './index.module.css'

interface PipelineProgressProps {
  meetingId: string
}

/** 홈 목록 카드와 회의 상세가 함께 쓰는 진행률 표시 (references/architecture.md) */
export default function PipelineProgress({ meetingId }: PipelineProgressProps) {
  const { stage, percent } = usePipelineProgress({ meetingId })
  const label = stage ? PIPELINE_STAGE_LABELS[stage] : PIPELINE_WAITING_LABEL

  return (
    <div className={styles.container}>
      <span className={styles.status}>
        <span className={styles.label}>{label}</span>
        <span className={styles.percent}>{percent}%</span>
      </span>
      <ProgressBar percent={percent} label="회의록 만드는 중" />
    </div>
  )
}
