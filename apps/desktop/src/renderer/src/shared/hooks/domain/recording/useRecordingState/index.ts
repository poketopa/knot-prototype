import { useCallback, useEffect, useRef, useState } from 'react'
import type { RecordingStateEvent } from '@shared/ipc'
import { onRecordingState } from '@renderer/shared/api/events'
import { getRecordingStateApi } from '@renderer/shared/api/recording'

const ELAPSED_TICK_MS = 200
const MS_PER_SEC = 1000
/** 파형이 그리는 최대 칸 수. 청크 주기(약 0.5초)마다 하나씩 쌓이므로 약 24초 분량이다 */
const LEVEL_HISTORY_SIZE = 48

const IDLE_STATE: RecordingStateEvent = { meetingId: null, startedAt: null, level: 0 }

/**
 * 진행 중 녹음의 상태를 구독한다. 단일 출처는 main의 녹음 세션이고 위젯 패널과 메인 창이 같은 값을 본다
 * (references/architecture.md의 "녹음 위젯 패널").
 */
const useRecordingState = () => {
  const [state, setState] = useState(IDLE_STATE)
  const [now, setNow] = useState(() => Date.now())
  const [levels, setLevels] = useState<number[]>([])
  const isEventReceivedRef = useRef(false)

  // 상태가 바뀐 순간의 시각을 함께 잡아 둔다. 그러지 않으면 녹음 중에 연 창이
  // 첫 타이머(약 0.2초)가 돌기 전까지 경과 시간을 0으로 보여준다
  const applyState = useCallback((next: RecordingStateEvent) => {
    setState(next)
    setNow(Date.now())
  }, [])

  // 레벨 기록은 이벤트가 올 때마다 쌓는다. 녹음이 아닐 때 온 이벤트(참석자 수 변경 등)는 파형을 비운다
  const applyEvent = useCallback(
    (next: RecordingStateEvent) => {
      isEventReceivedRef.current = true
      applyState(next)
      setLevels((current) =>
        next.meetingId === null ? [] : [...current, next.level].slice(-LEVEL_HISTORY_SIZE)
      )
    },
    [applyState]
  )

  // 늦게 열린 창은 상태 이벤트를 놓쳤을 수 있어 현재 값을 한 번 물어본다
  useEffect(() => {
    getRecordingStateApi()
      .then((next) => {
        // 조회하는 동안 이벤트가 먼저 왔다면 그쪽이 더 새롭다. 오래된 스냅샷으로 덮지 않는다
        if (!isEventReceivedRef.current) applyState(next)
      })
      .catch(() =>
        setState((current) => ({ ...current, errorMessage: '녹음 상태를 불러오지 못했습니다' }))
      )
  }, [applyState])

  useEffect(() => onRecordingState(applyEvent), [applyEvent])

  // 경과 시간은 startedAt으로 각자 계산한다 — 창이 가려져 렌더가 밀려도 값이 정확하다
  useEffect(() => {
    if (state.startedAt === null) return

    const timer = setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS)

    return () => clearInterval(timer)
  }, [state.startedAt])

  const elapsedSec =
    state.startedAt === null ? 0 : Math.max(0, (now - state.startedAt) / MS_PER_SEC)

  return {
    isRecording: state.meetingId !== null,
    meetingId: state.meetingId,
    level: state.level,
    levels,
    speakerCount: state.speakerCount,
    errorMessage: state.errorMessage,
    elapsedSec
  }
}

export default useRecordingState
