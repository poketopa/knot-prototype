import type { ReactNode } from 'react'
import { DEFAULT_RECORDING_SHORTCUT } from '@shared/shortcut'
import SettingGroup from '@renderer/shared/components/primitives/layout/SettingGroup'
import useSettings from '@renderer/shared/hooks/domain/setting/useSettings'

import ShortcutField from './ui/ShortcutField'
import styles from './index.module.css'

interface SettingsSectionProps {
  /** 설정 화면이 뒤에 붙일 모델·AI 카테고리 */
  children?: ReactNode
}

export default function SettingsSection({ children }: SettingsSectionProps) {
  const { settings, isLoading, error, updateSettings } = useSettings()

  // 모델 카테고리는 설정값과 무관하므로 설정을 못 불러와도 보여준다
  if (isLoading && !settings) {
    return (
      <div className={styles.section}>
        <p className={styles.message}>설정을 불러오는 중입니다</p>
        {children}
      </div>
    )
  }
  if (!settings) {
    return (
      <div className={styles.section}>
        <p className={styles.error} role="alert">
          {error?.message ?? '설정을 불러오지 못했습니다'}
        </p>
        {children}
      </div>
    )
  }

  return (
    <div className={styles.section}>
      {error ? (
        <p className={styles.error} role="alert">
          {error.message}
        </p>
      ) : null}
      <SettingGroup title="녹음·처리">
        <p className={styles.message}>
          녹음 파일·전사 원본·AI 정리본은 보관 기간 제한 없이 저장합니다.
        </p>
      </SettingGroup>
      <SettingGroup title="단축키">
        <ShortcutField
          title="녹음 시작·정지"
          accelerator={settings.recordingShortcut}
          defaultAccelerator={DEFAULT_RECORDING_SHORTCUT}
          onChange={(recordingShortcut) => updateSettings({ recordingShortcut })}
        >
          다른 앱을 쓰는 중에도 이 키로 녹음을 시작하고 정지합니다.
        </ShortcutField>
      </SettingGroup>
      {children}
    </div>
  )
}
