import TopBar from '@renderer/shared/components/primitives/layout/TopBar'

import styles from './Placeholder.module.css'

interface PlaceholderProps {
  title: string
  message: string
  isError?: boolean
}

/** 회의를 아직 못 그리는 상태(불러오는 중·없음·실패). 상단 바는 남겨 창을 끌 수 있게 한다 */
export default function Placeholder({ title, message, isError = false }: PlaceholderProps) {
  return (
    <>
      <TopBar title={title} />
      <p className={isError ? styles.error : styles.message}>{message}</p>
    </>
  )
}
