import styles from './index.module.css'

const MIN_PERCENT = 0
const MAX_PERCENT = 100

interface ProgressBarProps {
  percent: number
  /** 스크린 리더가 읽을 이름. 무엇의 진행률인지 알려 준다 */
  label: string
}

export default function ProgressBar({ percent, label }: ProgressBarProps) {
  const clamped = Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, Math.round(percent)))

  return (
    <div
      className={styles.track}
      role="progressbar"
      aria-label={label}
      aria-valuenow={clamped}
      aria-valuemin={MIN_PERCENT}
      aria-valuemax={MAX_PERCENT}
    >
      <div className={styles.fill} style={{ width: `${clamped}%` }} />
    </div>
  )
}
