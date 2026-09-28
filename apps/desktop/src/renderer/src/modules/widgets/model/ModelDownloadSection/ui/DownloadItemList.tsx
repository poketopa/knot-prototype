import type { ModelDownloadProgressEvent } from '@shared/ipc'
import type { ModelKey } from '@shared/types'
import Icon from '@renderer/shared/components/primitives/ui/Icon'
import ProgressBar from '@renderer/shared/components/primitives/ui/ProgressBar'
import { formatBytes } from '@renderer/shared/utils/formatBytes'

import type { PlannedItem } from '../utils/downloadPlan'
import styles from './DownloadItemList.module.css'

const FULL_PERCENT = 100

interface DownloadItemListProps {
  items: PlannedItem[]
  progress: Partial<Record<ModelKey, ModelDownloadProgressEvent>>
  isDownloading: boolean
}

/** 함께 받는 모델 목록. 항목마다 완료·진행률·대기(받기 전에는 용량)를 보여 준다 */
export default function DownloadItemList({
  items,
  progress,
  isDownloading
}: DownloadItemListProps) {
  const renderState = (item: PlannedItem) => {
    const percent = progress[item.key]?.percent

    if (item.isInstalled || percent === FULL_PERCENT) {
      return (
        <span className={styles.done}>
          <Icon name="check" size={13} />
          완료
        </span>
      )
    }
    if (!isDownloading)
      return <span className={styles.meta}>{formatBytes({ bytes: item.sizeBytes })}</span>
    if (percent === undefined) return <span className={styles.meta}>대기</span>

    return <span className={styles.meta}>{percent}%</span>
  }

  return (
    <div className={styles.box}>
      <span className={styles.heading}>함께 받는 모델</span>
      <ul className={styles.list}>
        {items.map((item) => {
          const percent = progress[item.key]?.percent
          const isInProgress =
            isDownloading && !item.isInstalled && percent !== undefined && percent < FULL_PERCENT

          return (
            <li key={item.key} className={styles.item}>
              <span className={styles.row}>
                <span>{item.label}</span>
                {renderState(item)}
              </span>
              {isInProgress ? (
                <ProgressBar percent={percent} label={`${item.label} 다운로드 진행률`} />
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
