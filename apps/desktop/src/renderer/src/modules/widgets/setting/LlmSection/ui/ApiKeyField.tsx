import { useId } from 'react'
import Button from '@renderer/shared/components/primitives/ui/Button'

import styles from './ApiKeyField.module.css'

interface ApiKeyFieldProps {
  label: string
  /** 저장된 키가 없을 때 보이는 발급 안내 */
  hint: string
  placeholder: string
  value: string
  hasSavedKey: boolean
  savedKeyTail: string | null
  isDisabled: boolean
  onChange: (value: string) => void
  onSave: () => void
  onClear: () => void
}

/** 키는 저장 후 입력란에서 지운다. 저장된 키는 유무와 마지막 4자만 보인다 (references/data-model.md) */
export default function ApiKeyField({
  label,
  hint,
  placeholder,
  value,
  hasSavedKey,
  savedKeyTail,
  isDisabled,
  onChange,
  onSave,
  onClear
}: ApiKeyFieldProps) {
  const inputId = useId()

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>
      <span className={styles.hint}>
        {hasSavedKey
          ? `저장된 키가 있습니다 (…${savedKeyTail ?? ''}). 새 키를 저장하면 바꿉니다.`
          : hint}
      </span>
      <div className={styles.row}>
        <input
          id={inputId}
          className={styles.input}
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={value}
          disabled={isDisabled}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && value.trim()) onSave()
          }}
        />
        <Button size="sm" onClick={onSave} disabled={isDisabled || !value.trim()}>
          저장
        </Button>
        {hasSavedKey && (
          <Button variant="secondary" size="sm" onClick={onClear} disabled={isDisabled}>
            키 삭제
          </Button>
        )}
      </div>
    </div>
  )
}
