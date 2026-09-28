import type { ReactNode } from 'react'
import { formatAccelerator } from '@shared/shortcut'
import SettingRow from '@renderer/shared/components/primitives/layout/SettingRow'

import useShortcutCapture from '../model/useShortcutCapture'
import styles from './ShortcutField.module.css'

interface ShortcutFieldProps {
  title: string
  accelerator: string
  defaultAccelerator: string
  onChange: (accelerator: string) => void
  children: ReactNode
}

export default function ShortcutField({
  title,
  accelerator,
  defaultAccelerator,
  onChange,
  children
}: ShortcutFieldProps) {
  const { isCapturing, error, startCapture, stopCapture, handleKeyDown } = useShortcutCapture({
    onCapture: onChange
  })

  return (
    <SettingRow
      title={title}
      description={
        <>
          {children}
          {error ? (
            <span className={styles.error} role="alert">
              {' '}
              {error.message}
            </span>
          ) : null}
        </>
      }
      control={
        <>
          <button
            type="button"
            className={isCapturing ? styles.captureActive : styles.capture}
            aria-label={`${title} 변경`}
            onClick={startCapture}
            onKeyDown={handleKeyDown}
            onBlur={stopCapture}
          >
            {isCapturing ? '키를 누르세요…' : formatAccelerator(accelerator)}
          </button>
          {accelerator === defaultAccelerator ? null : (
            <button
              type="button"
              className={styles.reset}
              onClick={() => onChange(defaultAccelerator)}
            >
              기본값 {formatAccelerator(defaultAccelerator)}로
            </button>
          )}
        </>
      }
    />
  )
}
