import { useId } from 'react'
import type { OpenaiModelId } from '@shared/types'
import { isOpenaiModelId, OPENAI_MODELS } from '@shared/llm'

import styles from './OpenaiModelSelect.module.css'

interface OpenaiModelSelectProps {
  value: OpenaiModelId
  isDisabled: boolean
  onChange: (model: OpenaiModelId) => void
}

/** GPT-6 계열 셋 중 하나. 라디오를 또 쌓지 않고 select 하나로 둔다 (references/architecture.md "LLM 공급자" 화면) */
export default function OpenaiModelSelect({ value, isDisabled, onChange }: OpenaiModelSelectProps) {
  const selectId = useId()
  const selected = OPENAI_MODELS.find((model) => model.id === value)

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={selectId}>
        GPT 모델
      </label>
      <span className={styles.hint}>
        {selected?.description ?? '요약과 용어 초안에 쓸 모델입니다'}. 다음 요약부터 적용됩니다.
      </span>
      <select
        id={selectId}
        className={styles.select}
        value={value}
        disabled={isDisabled}
        onChange={(event) => {
          if (isOpenaiModelId(event.target.value)) onChange(event.target.value)
        }}
      >
        {OPENAI_MODELS.map((model) => (
          <option key={model.id} value={model.id}>
            {model.title}
          </option>
        ))}
      </select>
    </div>
  )
}
