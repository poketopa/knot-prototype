import styles from './ProviderOption.module.css'

interface ProviderOptionProps {
  value: string
  title: string
  description: string
  isSelected: boolean
  isDisabled: boolean
  onSelect: () => void
}

export default function ProviderOption({
  value,
  title,
  description,
  isSelected,
  isDisabled,
  onSelect
}: ProviderOptionProps) {
  return (
    <label className={[styles.option, isSelected ? styles.selected : ''].join(' ')}>
      <input
        className={styles.radio}
        type="radio"
        name="llmProvider"
        value={value}
        checked={isSelected}
        disabled={isDisabled}
        onChange={onSelect}
      />
      <span className={styles.body}>
        <span className={styles.title}>{title}</span>
        <span className={styles.description}>{description}</span>
      </span>
    </label>
  )
}
