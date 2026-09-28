import type { WhisperModelChoice } from '@shared/ipc'
import Badge from '@renderer/shared/components/primitives/ui/Badge'
import { formatBytes } from '@renderer/shared/utils/formatBytes'

import styles from './ModelOption.module.css'

interface ModelOptionProps {
  option: WhisperModelChoice
  isSelected: boolean
  isRecommended: boolean
  isDisabled: boolean
  onSelect: () => void
}

export default function ModelOption({
  option,
  isSelected,
  isRecommended,
  isDisabled,
  onSelect
}: ModelOptionProps) {
  return (
    <label className={[styles.option, isSelected ? styles.selected : ''].join(' ')}>
      <input
        className={styles.radio}
        type="radio"
        name="whisperModel"
        value={option.id}
        checked={isSelected}
        disabled={isDisabled}
        onChange={onSelect}
      />
      <span className={styles.body}>
        <span className={styles.titleRow}>
          <span className={styles.title}>{option.label}</span>
          {isRecommended && <Badge tone="accent">이 컴퓨터에 권장</Badge>}
          <span className={styles.size}>{formatBytes({ bytes: option.sizeBytes })}</span>
        </span>
        <span className={styles.description}>{option.description}</span>
      </span>
    </label>
  )
}
