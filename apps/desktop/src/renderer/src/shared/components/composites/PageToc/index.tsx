import type { ReactNode } from 'react'

import usePageToc from './model/usePageToc'
import styles from './index.module.css'

interface PageTocProps {
  /** 목차 nav의 접근성 이름 */
  label: string
  children: ReactNode
}

/**
 * 세로 스크롤 영역 + 오른쪽 목차. 본문 안의 h2를 읽어 목차를 만들고, 누르면 그 제목으로 스크롤한다.
 * 창이 좁으면 목차를 숨긴다 (references/architecture.md "설정 화면").
 */
export default function PageToc({ label, children }: PageTocProps) {
  const { scrollRef, items, activeIndex, scrollTo } = usePageToc()

  return (
    <div ref={scrollRef} className={styles.scroll}>
      <div className={styles.layout}>
        <div className={styles.content}>{children}</div>
        {items.length > 1 ? (
          <nav className={styles.toc} aria-label={label}>
            <ul className={styles.list}>
              {items.map((item, i) => (
                <li key={item.key}>
                  <button
                    type="button"
                    className={styles.item}
                    aria-current={i === activeIndex ? 'location' : undefined}
                    onClick={() => scrollTo(item)}
                  >
                    {item.title}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </div>
    </div>
  )
}
