import { formatTimestamp } from '@meeting-stt/core/format'
import type { Utterance } from '@shared/types'
import InlineEditableText from '@renderer/shared/components/composites/InlineEditableText'
import Icon from '@renderer/shared/components/primitives/ui/Icon'

import type { SpeakerOption } from '../types/transcript'
import { speakerToneOf } from '../utils/speakerTone'
import styles from './UtteranceRow.module.css'

interface UtteranceRowProps {
  utterance: Utterance
  speakerOptions: SpeakerOption[]
  isCopied: boolean
  onChangeSpeaker: (params: { utteranceId: string; speakerLabel: string }) => void
  onCommitText: (params: { utteranceId: string; text: string }) => void
  onCopy: (params: { utterance: Utterance }) => void
}

/** 시각 · (화자 + 본문) · 복사. 복사 버튼은 행에 마우스를 올리거나 포커스가 들어올 때만 보인다 */
export default function UtteranceRow({
  utterance,
  speakerOptions,
  isCopied,
  onChangeSpeaker,
  onCommitText,
  onCopy
}: UtteranceRowProps) {
  const tone = speakerToneOf({ speakerOptions, label: utterance.speakerLabel })

  return (
    <li className={styles.row}>
      <span className={styles.time}>{formatTimestamp({ sec: utterance.startSec })}</span>
      <div className={styles.body}>
        <span className={[styles.speaker, styles[`tone${tone}`]].join(' ')}>
          <span className={styles.dot} aria-hidden="true" />
          <select
            className={styles.speakerSelect}
            aria-label="화자 변경"
            value={utterance.speakerLabel}
            onChange={(event) =>
              onChangeSpeaker({ utteranceId: utterance.id, speakerLabel: event.target.value })
            }
          >
            {speakerOptions.map(({ label, name }) => (
              <option key={label} value={label}>
                {name}
              </option>
            ))}
          </select>
          <Icon name="chevronDown" size={12} />
        </span>
        <InlineEditableText
          isMultiline
          className={styles.text}
          value={utterance.text}
          ariaLabel="발화 내용"
          onCommit={(text) => onCommitText({ utteranceId: utterance.id, text })}
        />
      </div>
      <button
        type="button"
        className={[styles.copy, isCopied ? styles.copied : ''].join(' ')}
        aria-label={isCopied ? '복사했습니다' : '이 발화 복사'}
        title={isCopied ? '복사했습니다' : '이 발화 복사'}
        onClick={() => onCopy({ utterance })}
      >
        <Icon name={isCopied ? 'check' : 'copy'} size={14} />
      </button>
    </li>
  )
}
