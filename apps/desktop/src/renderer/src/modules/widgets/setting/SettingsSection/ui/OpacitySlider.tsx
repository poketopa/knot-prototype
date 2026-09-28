import styles from './OpacitySlider.module.css'

interface OpacitySliderProps {
  value: number
  min: number
  max: number
  step: number
  isDisabled: boolean
  onChange: (value: number) => void
}

const PERCENT = 100

export default function OpacitySlider({
  value,
  min,
  max,
  step,
  isDisabled,
  onChange
}: OpacitySliderProps) {
  return (
    <label className={styles.slider}>
      <span className={styles.label}>포커스가 없을 때 불투명도</span>
      <input
        className={styles.input}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={isDisabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className={styles.value}>{Math.round(value * PERCENT)}%</span>
    </label>
  )
}
