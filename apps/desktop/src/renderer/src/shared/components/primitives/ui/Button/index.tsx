import type { ButtonHTMLAttributes } from 'react'

import styles from './index.module.css'

export type ButtonVariant = 'accent' | 'primary' | 'secondary' | 'danger'
export type ButtonSize = 'sm' | 'md'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 강조색(`accent`)은 화면당 하나, 빨강(`danger`)은 삭제 확인에만 쓴다 */
  variant?: ButtonVariant
  size?: ButtonSize
}

export default function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={[styles.button, styles[variant], styles[size], className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  )
}
