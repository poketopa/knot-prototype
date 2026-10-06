import { useEffect, useMemo, useState } from 'react'
import { getProcessingApi, onPrototypeChanged } from '@renderer/shared/api/prototype'
import { getRecordingStateApi } from '@renderer/shared/api/recording'
import { recordReturnPathFor } from './recordReturn'

export const useRecordReturnPath = (disabled = false) => {
  const generation = useMemo(() => ({ disabled }), [disabled])
  const [state, setState] = useState<{ generation: { disabled: boolean }; path: string | null }>(
    () => ({
      generation,
      path: null
    })
  )

  useEffect(() => {
    if (disabled) return

    let isMounted = true
    let requestId = 0
    const refresh = async () => {
      const currentRequestId = ++requestId
      try {
        const recordingState = await getRecordingStateApi()
        if (!isMounted || currentRequestId !== requestId) return
        if (recordingState.meetingId) {
          setState({ generation, path: null })
          return
        }
        const items = await getProcessingApi()
        if (isMounted && currentRequestId === requestId) {
          setState({ generation, path: recordReturnPathFor(items) })
        }
      } catch {
        if (isMounted && currentRequestId === requestId) setState({ generation, path: null })
      }
    }

    void refresh()
    const unsubscribe = onPrototypeChanged(({ reason }) => {
      if (reason !== 'event') void refresh()
    })

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [disabled, generation])

  return disabled || state.generation !== generation ? null : state.path
}
