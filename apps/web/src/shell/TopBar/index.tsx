import type { ReactNode } from 'react'

import styles from './index.module.css'

interface TopBarProps {
  /** 왼쪽 회색 글자 */
  title: string
  /** 오른쪽 동작 */
  children?: ReactNode
}

/** 본문 상단 56px 바. 모든 화면이 같은 모양이다 */
export default function TopBar({ title, children }: TopBarProps) {
  return (
    <div className={styles.bar}>
      <span className={styles.title}>{title}</span>
      {children ? <div className={styles.actions}>{children}</div> : null}
    </div>
  )
}
