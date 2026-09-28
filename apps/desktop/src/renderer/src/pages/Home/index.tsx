import { Link } from 'react-router'
import TopBar from '@renderer/shared/components/primitives/layout/TopBar'
import { PATHS } from '@renderer/shared/routes/paths'

import styles from './index.module.css'

/** 회의 목록은 사이드바가 들고 있어 홈은 빈 상태 안내만 한다 */
export default function Home() {
  return (
    <>
      <TopBar title="회의록" />
      <div className={styles.empty}>
        <h1 className={styles.title}>회의를 고르거나 새로 녹음하세요</h1>
        <p className={styles.description}>
          녹음한 회의는 이 컴퓨터 안에서 화자별 회의록으로 정리됩니다.
        </p>
        <Link className={styles.recordLink} to={PATHS.record}>
          새 녹음 시작하기
        </Link>
      </div>
    </>
  )
}
