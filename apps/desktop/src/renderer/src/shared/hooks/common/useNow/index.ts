import { useEffect, useState } from 'react'

interface UseNowParams {
  intervalMs: number
}

/** 렌더 중에 Date.now()를 부르지 않도록 현재 시각을 상태로 들고 주기적으로 갱신한다 */
const useNow = ({ intervalMs }: UseNowParams) => {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)

    return () => clearInterval(timer)
  }, [intervalMs])

  return { now }
}

export default useNow
