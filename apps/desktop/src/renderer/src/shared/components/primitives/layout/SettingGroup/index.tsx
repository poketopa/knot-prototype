import { useId, type ReactNode } from 'react'

import styles from './index.module.css'

interface SettingGroupProps {
  title: string
  children: ReactNode
}

/** 설정 카테고리. 회색 소제목 + 행 목록 (references/architecture.md "공통 컴포넌트") */
export default function SettingGroup({ title, children }: SettingGroupProps) {
  const titleId = useId()

  return (
    <section className={styles.group} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.title}>
        {title}
      </h2>
      {children}
    </section>
  )
}
