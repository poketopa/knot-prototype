import Button from '@renderer/shared/components/primitives/ui/Button'
import useUpdate from '@renderer/shared/hooks/domain/update/useUpdate'

import styles from './index.module.css'

/** 새 버전 이벤트를 받았을 때만 나타난다. 내려받기·설치는 사용자가 누른다 (references/distribution.md 7절) */
export default function UpdateBanner() {
  const { version, stage, error, download, install } = useUpdate()

  if (stage === 'idle' || !version) return null

  const renderAction = () => {
    if (stage === 'downloading') return <Button disabled>내려받는 중</Button>
    if (stage === 'downloaded') return <Button onClick={install}>다시 시작해 설치</Button>

    return <Button onClick={download}>{stage === 'error' ? '다시 시도' : '받기'}</Button>
  }

  return (
    <div className={styles.banner} role="status">
      <span className={styles.text}>
        새 버전 {version}이 있습니다.
        {stage === 'downloaded' && ' 내려받기가 끝났습니다.'}
        {stage === 'error' && error && <span className={styles.error}> {error}</span>}
      </span>
      {renderAction()}
    </div>
  )
}
