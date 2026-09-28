import styles from './index.module.css'

interface SwitchProps {
  isChecked: boolean
  onChange: (isChecked: boolean) => void
  /** 화면에 보이는 제목이 없을 때 쓴다. 설정 행처럼 제목이 있으면 `ariaLabelledBy`로 그 id를 가리킨다 */
  ariaLabel?: string
  ariaLabelledBy?: string
  id?: string
  disabled?: boolean
}

/** 켜기/끄기. 네이티브 버튼이라 Space·Enter로도 토글된다 */
export default function Switch({
  isChecked,
  onChange,
  ariaLabel,
  ariaLabelledBy,
  id,
  disabled = false
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      className={styles.track}
      aria-checked={isChecked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      disabled={disabled}
      onClick={() => onChange(!isChecked)}
    >
      <span className={styles.thumb} />
    </button>
  )
}
