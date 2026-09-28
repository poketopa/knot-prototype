import { useId, type ReactNode } from 'react'
import SettingRow from '@renderer/shared/components/primitives/layout/SettingRow'
import Switch from '@renderer/shared/components/primitives/ui/Switch'

interface SettingToggleProps {
  title: string
  isChecked: boolean
  onChange: (isChecked: boolean) => void
  /** 설정을 껐을 때 무엇이 달라지는지. 되돌릴 수 없는 결과는 여기에 적는다 */
  children: ReactNode
}

export default function SettingToggle({
  title,
  isChecked,
  onChange,
  children
}: SettingToggleProps) {
  const titleId = useId()

  return (
    <SettingRow
      title={title}
      titleId={titleId}
      description={children}
      control={<Switch isChecked={isChecked} onChange={onChange} ariaLabelledBy={titleId} />}
    />
  )
}
