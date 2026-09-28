import type { MouseEvent } from 'react'

/**
 * 표시 상태에서 클릭한 지점이 텍스트의 몇 번째 글자인지 구한다.
 * 편집 요소로 바뀐 뒤 커서를 같은 자리에 두어, 다시 글자를 찾아가지 않아도 되게 한다.
 * 키보드로 진입했거나 텍스트 밖을 클릭하면 null (끝에 커서).
 */
const getCaretOffset = (event: MouseEvent<HTMLElement>) => {
  // 키보드(Enter·Space)로 누른 클릭은 detail이 0이라 좌표가 의미 없다
  if (event.detail === 0) return null
  // Electron의 Chromium에는 있지만 테스트 DOM(happy-dom)에는 없다. 없으면 끝에 커서로 물러난다
  if (typeof document.caretPositionFromPoint !== 'function') return null

  const position = document.caretPositionFromPoint(event.clientX, event.clientY)
  if (!position || !event.currentTarget.contains(position.offsetNode)) return null
  // 표시 요소 안에는 value 하나만 텍스트 노드로 들어 있어 노드 안 오프셋이 곧 value 오프셋이다
  if (position.offsetNode.nodeType !== Node.TEXT_NODE) return null

  return position.offset
}

export default getCaretOffset
