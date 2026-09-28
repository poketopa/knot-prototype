import Button from '@renderer/shared/components/primitives/ui/Button'
import useUpdate from '@renderer/shared/hooks/domain/update/useUpdate'

import styles from './index.module.css'

/**
 * 설정의 "업데이트 확인" 토글과 무관하게 사용자가 누를 때 확인한다.
 * 새 버전이 있으면 그 자리에서 받기 → 다시 시작해 설치로 이어진다 (references/distribution.md 7절)
 */
export default function UpdateCheck() {
  const { version, currentVersion, stage, error, check, download, install } = useUpdate()

  const renderMessage = () => {
    if (stage === 'checking') return '새 버전을 확인하는 중입니다'
    if (stage === 'latest') return `최신 버전(${currentVersion})을 쓰고 있습니다`
    if (stage === 'downloaded') return `새 버전 ${version}을 내려받았습니다`
    if (version) return `새 버전 ${version}이 있습니다`
    if (stage === 'error') return null

    return '설정과 관계없이 지금 새 버전이 있는지 확인합니다'
  }

  const renderAction = () => {
    if (stage === 'checking') return <Button disabled>확인 중</Button>
    if (stage === 'downloading') return <Button disabled>내려받는 중</Button>
    if (stage === 'downloaded') return <Button onClick={install}>다시 시작해 설치</Button>
    if (version) {
      return <Button onClick={download}>{stage === 'error' ? '다시 시도' : '받기'}</Button>
    }

    return (
      <Button variant="secondary" onClick={check}>
        지금 확인
      </Button>
    )
  }

  return (
    <div className={styles.container} role="status">
      <span className={styles.text}>
        {renderMessage()}
        {stage === 'error' && error ? <span className={styles.error}> {error}</span> : null}
      </span>
      {renderAction()}
    </div>
  )
}
