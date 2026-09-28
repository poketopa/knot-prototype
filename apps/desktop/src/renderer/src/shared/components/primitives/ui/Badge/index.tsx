import type { ReactNode } from 'react'

import styles from './index.module.css'

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'danger'

interface BadgeProps {
  tone?: BadgeTone
  children: ReactNode
}

export default function Badge({ tone = 'neutral', children }: BadgeProps) {
  return <span className={[styles.badge, styles[tone]].join(' ')}>{children}</span>
}
