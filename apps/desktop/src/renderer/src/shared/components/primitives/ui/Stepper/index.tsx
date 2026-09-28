import styles from './index.module.css'

interface StepperProps {
  /** 입력 중인 문자열. 비어 있거나 잘못된 값도 그대로 들고 검증은 부모가 한다 */
  value: string
  onChange: (text: string) => void
  min: number
  max: number
  /** 입력의 접근성 이름. −/+ 버튼 이름에도 붙는다 */
  label: string
  id?: string
  placeholder?: string
  isInvalid?: boolean
}

interface StepParams {
  value: string
  min: number
  max: number
}

const EMPTY = ''

const parseInteger = (value: string) => {
  const parsed = Number(value.trim())
  return value.trim() !== EMPTY && Number.isInteger(parsed) ? parsed : null
}

const decrement = ({ value, min, max }: StepParams) => {
  const current = parseInteger(value)
  if (current === null || current <= min) return EMPTY
  return String(Math.min(max, current - 1))
}

const increment = ({ value, min, max }: StepParams) => {
  const current = parseInteger(value)
  if (current === null || current < min) return String(min)
  return String(Math.min(max, current + 1))
}

/**
 * 숫자 입력 + −/+. 최솟값에서 −를 누르면 값을 비운다 ("모름"),
 * 빈 값에서 +를 누르면 최솟값부터 시작한다 (references/architecture.md "공통 컴포넌트").
 */
export default function Stepper({
  value,
  onChange,
  min,
  max,
  label,
  id,
  placeholder,
  isInvalid = false
}: StepperProps) {
  const current = parseInteger(value)
  const isDecrementDisabled = current === null
  const isIncrementDisabled = current !== null && current >= max

  return (
    <div className={styles.container}>
      <button
        type="button"
        className={styles.stepButton}
        aria-label={`${label} 줄이기`}
        disabled={isDecrementDisabled}
        onClick={() => onChange(decrement({ value, min, max }))}
      >
        −
      </button>
      <input
        id={id}
        className={styles.input}
        type="text"
        inputMode="numeric"
        aria-label={label}
        aria-invalid={isInvalid}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        className={styles.stepButton}
        aria-label={`${label} 늘리기`}
        disabled={isIncrementDisabled}
        onClick={() => onChange(increment({ value, min, max }))}
      >
        +
      </button>
    </div>
  )
}
