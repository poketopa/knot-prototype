import { useEffect, useRef, useState } from 'react'

export interface TocItem {
  key: string
  title: string
  element: HTMLElement
}

// 제목이 스크롤 영역 위에서 이만큼 안쪽으로 들어오면 그 카테고리를 읽는 중으로 본다
const ACTIVE_OFFSET_PX = 96
// 스크롤이 끝에 닿았는지 볼 때 소수점 픽셀 오차를 흡수한다
const BOTTOM_TOLERANCE_PX = 2

const readItems = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('h2')).map((element) => {
    const title = element.textContent?.trim() ?? ''
    return { key: element.id || title, title, element }
  })

const isSameItems = (prev: TocItem[], next: TocItem[]) =>
  prev.length === next.length &&
  prev.every((item, i) => item.element === next[i].element && item.title === next[i].title)

const findActiveIndex = (scroller: HTMLElement, items: TocItem[]) => {
  const isAtBottom =
    scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - BOTTOM_TOLERANCE_PX
  // 마지막 카테고리가 짧으면 위쪽 기준선까지 올라오지 못하므로 끝에 닿으면 마지막을 고른다
  if (isAtBottom) return items.length - 1

  const threshold = scroller.getBoundingClientRect().top + ACTIVE_OFFSET_PX
  const passed = items.filter((item) => item.element.getBoundingClientRect().top <= threshold)
  return Math.max(passed.length - 1, 0)
}

/**
 * 스크롤 영역 안의 h2를 목차 항목으로 읽고, 스크롤 위치에 맞는 항목을 고른다.
 * 카테고리가 여러 위젯에 흩어져 있고 로드 전후로 개수가 달라지므로 DOM이 바뀔 때마다 다시 읽는다.
 */
const usePageToc = () => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [items, setItems] = useState<TocItem[]>([])
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return

    let currentItems: TocItem[] = []
    const sync = () => {
      const next = readItems(scroller)
      if (!isSameItems(currentItems, next)) {
        currentItems = next
        setItems(next)
      }
      setActiveIndex(findActiveIndex(scroller, currentItems))
    }

    sync()
    const observer = new MutationObserver(sync)
    observer.observe(scroller, { childList: true, subtree: true, characterData: true })
    scroller.addEventListener('scroll', sync, { passive: true })
    return () => {
      observer.disconnect()
      scroller.removeEventListener('scroll', sync)
    }
  }, [])

  const scrollTo = (item: TocItem) => {
    item.element.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return { scrollRef, items, activeIndex, scrollTo }
}

export default usePageToc
