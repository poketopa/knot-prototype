import type { ReactNode } from 'react'

export type IconName =
  'mic' | 'search' | 'settings' | 'copy' | 'markdown' | 'more' | 'close' | 'check' | 'chevronDown'

interface IconProps {
  name: IconName
  size?: number
}

const DEFAULT_SIZE = 16

/** 24×24 격자의 stroke 아이콘. 색은 글자색(currentColor)을 따른다 */
const PATHS: Record<IconName, ReactNode> = {
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </>
  ),
  markdown: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M6 15V9l3 3 3-3v6" />
      <path d="M17 9v6" />
      <path d="m15 13 2 2 2-2" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5 12 5 5 9-10" />,
  chevronDown: <path d="m6 9 6 6 6-6" />
}

/** 장식용이다. 아이콘만 있는 버튼은 버튼 쪽에 aria-label을 붙인다 */
export default function Icon({ name, size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}
