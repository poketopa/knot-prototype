import type { ReactNode } from 'react'

import styles from './index.module.css'

interface SettingRowProps {
  title: ReactNode
  /** 제목 요소의 id. 오른쪽 스위치가 `ariaLabelledBy`로 가리킨다 */
  titleId?: string
  description?: ReactNode
  /** 오른쪽 컨트롤 (스위치·버튼) */
  control?: ReactNode
  /** 행 아래에 붙는 펼침 영역 (모델 선택, 진행률) */
  children?: ReactNode
}

/** 설정 한 행. 왼쪽 제목·설명, 오른쪽 컨트롤 (references/architecture.md "공통 컴포넌트") */
export default function SettingRow({
  title,
  titleId,
  description,
  control,
  children
}: SettingRowProps) {
  return (
    <div className={styles.row}>
      <div className={styles.main}>
        <div className={styles.text}>
          <span id={titleId} className={styles.title}>
            {title}
          </span>
          {description ? <span className={styles.description}>{description}</span> : null}
        </div>
        {control ? <div className={styles.control}>{control}</div> : null}
      </div>
      {children}
    </div>
  )
}
