import { useState } from 'react'
import type { Utterance } from '@shared/types'
import InlineEditableText from '@renderer/shared/components/composites/InlineEditableText'
import Button from '@renderer/shared/components/primitives/ui/Button'

import type { SpeakerOption } from '../types/transcript'
import { speakerToneOf } from '../utils/speakerTone'
import styles from './SpeakerPanel.module.css'

interface SpeakerPanelProps {
  speakerOptions: SpeakerOption[]
  utterances: Utterance[]
  onRenameSpeaker: (params: { label: string; displayName: string }) => void
  onMergeSpeakers: (params: { fromLabel: string; intoLabel: string }) => void
}

/**
 * 오른쪽 레일의 화자 목록. 이름은 눌러서 바로 고치고, 병합은 "화자 합치기"로 모드를 켠 뒤
 * 행의 "합치기" → 대상 선택 두 단계를 거친다 (되돌릴 수 없는 동작의 인라인 확인).
 */
export default function SpeakerPanel({
  speakerOptions,
  utterances,
  onRenameSpeaker,
  onMergeSpeakers
}: SpeakerPanelProps) {
  const [isMerging, setIsMerging] = useState(false)
  const [mergingLabel, setMergingLabel] = useState<string | null>(null)

  const countOf = (label: string) =>
    utterances.filter((utterance) => utterance.speakerLabel === label).length

  const handleToggleMerge = () => {
    setIsMerging(!isMerging)
    setMergingLabel(null)
  }

  const handleMerge = ({ fromLabel, intoLabel }: { fromLabel: string; intoLabel: string }) => {
    setIsMerging(false)
    setMergingLabel(null)
    onMergeSpeakers({ fromLabel, intoLabel })
  }

  const renderMergeTargets = ({ label, name }: SpeakerOption) => (
    <div className={styles.targets}>
      <span className={styles.targetsLabel}>{name}을(를) 누구에게 합칠까요?</span>
      {speakerOptions
        .filter((option) => option.label !== label)
        .map((option) => (
          <Button
            key={option.label}
            variant="secondary"
            size="sm"
            onClick={() => handleMerge({ fromLabel: label, intoLabel: option.label })}
          >
            {option.name}에 합치기
          </Button>
        ))}
    </div>
  )

  return (
    <section className={styles.panel} aria-label="화자">
      <header className={styles.header}>
        <h2 className={styles.title}>화자</h2>
        {speakerOptions.length > 1 ? (
          <Button
            variant="secondary"
            size="sm"
            aria-expanded={isMerging}
            onClick={handleToggleMerge}
          >
            {isMerging ? '합치기 끝내기' : '화자 합치기'}
          </Button>
        ) : null}
      </header>
      <ul className={styles.list}>
        {speakerOptions.map((option) => (
          <li key={option.label} className={styles.item}>
            <span className={styles.row}>
              <span
                className={[
                  styles.dot,
                  styles[`tone${speakerToneOf({ speakerOptions, label: option.label })}`]
                ].join(' ')}
                aria-hidden="true"
              />
              <InlineEditableText
                className={styles.name}
                value={option.name}
                ariaLabel={`${option.name} 이름`}
                onCommit={(displayName) => onRenameSpeaker({ label: option.label, displayName })}
              />
              {isMerging ? (
                <Button
                  variant="secondary"
                  size="sm"
                  aria-expanded={mergingLabel === option.label}
                  onClick={() =>
                    setMergingLabel(mergingLabel === option.label ? null : option.label)
                  }
                >
                  {mergingLabel === option.label ? '취소' : '합치기'}
                </Button>
              ) : (
                <span className={styles.count}>발화 {countOf(option.label)}</span>
              )}
            </span>
            {mergingLabel === option.label ? renderMergeTargets(option) : null}
          </li>
        ))}
      </ul>
      <p className={styles.hint}>이름을 누르면 바로 바꿀 수 있습니다. Enter로 저장, Esc로 취소.</p>
    </section>
  )
}
