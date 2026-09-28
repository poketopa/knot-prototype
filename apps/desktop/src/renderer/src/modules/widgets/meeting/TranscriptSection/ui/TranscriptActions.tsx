import { useState, type FocusEvent, type KeyboardEvent } from 'react'
import type { TranscriptFormat } from '@meeting-stt/core/format'
import Button from '@renderer/shared/components/primitives/ui/Button'
import Icon from '@renderer/shared/components/primitives/ui/Icon'

import styles from './TranscriptActions.module.css'

interface TranscriptActionsProps {
  isCopyEnabled: boolean
  copiedKey: string | null
  onCopy: (params: { format: TranscriptFormat }) => void
  onDelete: () => void
}

type MenuStage = 'closed' | 'open' | 'confirming'

/** 상단 바의 복사·더보기. 회의 삭제는 더보기 안에서 2단계 인라인 확인을 거친다 */
export default function TranscriptActions({
  isCopyEnabled,
  copiedKey,
  onCopy,
  onDelete
}: TranscriptActionsProps) {
  const [menuStage, setMenuStage] = useState<MenuStage>('closed')

  const copyLabel = ({ format, text }: { format: TranscriptFormat; text: string }) =>
    copiedKey === format ? '복사했습니다' : text

  // 메뉴 밖으로 포커스가 나가면 닫는다. 메뉴 안의 버튼 사이 이동은 유지한다
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setMenuStage('closed')
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') setMenuStage('closed')
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        disabled={!isCopyEnabled}
        onClick={() => onCopy({ format: 'plain' })}
      >
        <Icon name="copy" size={14} />
        {copyLabel({ format: 'plain', text: '전체 복사' })}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        disabled={!isCopyEnabled}
        onClick={() => onCopy({ format: 'markdown' })}
      >
        <Icon name="markdown" size={14} />
        {copyLabel({ format: 'markdown', text: '마크다운으로 복사' })}
      </Button>
      <div className={styles.menuContainer} onBlur={handleBlur} onKeyDown={handleKeyDown}>
        <button
          type="button"
          className={styles.moreButton}
          aria-label="회의 더보기"
          aria-expanded={menuStage !== 'closed'}
          onClick={() => setMenuStage(menuStage === 'closed' ? 'open' : 'closed')}
        >
          <Icon name="more" />
        </button>
        {menuStage === 'open' ? (
          <div className={styles.menu}>
            <button
              type="button"
              className={styles.menuItem}
              onClick={() => setMenuStage('confirming')}
            >
              회의 삭제
            </button>
          </div>
        ) : null}
        {menuStage === 'confirming' ? (
          <div className={styles.confirm} role="alert">
            <span>이 회의와 회의록, 원본 녹음이 모두 사라집니다. 되돌릴 수 없습니다.</span>
            <span className={styles.confirmActions}>
              <Button variant="secondary" size="sm" onClick={() => setMenuStage('closed')}>
                취소
              </Button>
              <Button variant="danger" size="sm" onClick={onDelete}>
                삭제
              </Button>
            </span>
          </div>
        ) : null}
      </div>
    </>
  )
}
