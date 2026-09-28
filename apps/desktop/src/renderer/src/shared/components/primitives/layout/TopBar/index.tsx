import type { ReactNode } from 'react'

import styles from './index.module.css'

interface TopBarProps {
  title: string
  children?: ReactNode
}

/** 본문 상단 52px 바. 바 전체가 창을 끄는 영역이고 안의 컨트롤만 클릭을 받는다 (references/pitfalls.md) */
export default function TopBar({ title, children }: TopBarProps) {
  return (
    <div className={styles.bar}>
      <span className={styles.title}>{title}</span>
      {children ? <div className={styles.actions}>{children}</div> : null}
    </div>
  )
}
