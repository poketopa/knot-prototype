import { useRef, useState, type ReactNode } from 'react'

import { pickAutoOptions } from '../lib/autoOptions'
import { probeModelCache } from '../lib/modelCache'
import { probeWebGpu } from '../lib/webgpu'
import { loadAudio } from '../pipeline/loadAudio'
import { runPipeline } from '../pipeline/runPipeline'
import type { MeetingRecord } from '../types/meeting'
import { JobContext, type JobContextValue, type JobState } from './jobContext'
import { applyProgress, completedSteps, initialSteps, overallPercent } from './jobProgress'
import { useMeetings } from './meetingsContext'

interface JobProviderProps {
  children: ReactNode
}

const ABORT_MESSAGE = '사용자가 중단했습니다'
const PERCENT_MAX = 100

const toMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** 파이프라인은 화면을 옮겨도 계속 돌아야 하므로 셸 수준에서 한 번만 소유한다 */
export default function JobProvider({ children }: JobProviderProps) {
  const [job, setJob] = useState<JobState | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const { patch } = useMeetings()

  const run = async (meeting: MeetingRecord) => {
    const controller = new AbortController()
    abortRef.current = controller

    const options = pickAutoOptions(await probeWebGpu())
    const cache = await probeModelCache({
      whisperModel: options.whisperModel,
      sttDtype: options.sttDtype
    })
    const isDownloadExpected = cache.isReadable && cache.cachedCount < cache.totalCount

    setJob({ meetingId: meeting.id, steps: initialSteps(), overallPercent: 0, isDownloadExpected })
    await patch({ id: meeting.id, patch: { status: 'processing', errorMessage: null } })

    const startedAt = performance.now()

    try {
      const file = new File([meeting.audio], meeting.audioName, { type: meeting.audio.type })
      const audio = await loadAudio(file)
      const result = await runPipeline({
        samples: audio.samples,
        sampleRate: audio.sampleRate,
        speakerCount: meeting.speakerCount,
        ...options,
        signal: controller.signal,
        onProgress: (progress) =>
          setJob((previous) => {
            if (!previous) return previous

            const steps = applyProgress({ steps: previous.steps, progress })
            return {
              ...previous,
              steps,
              overallPercent: overallPercent({ steps, isDownloadExpected })
            }
          })
      })

      setJob((previous) =>
        previous ? { ...previous, steps: completedSteps(), overallPercent: PERCENT_MAX } : previous
      )
      await patch({
        id: meeting.id,
        patch: {
          status: 'done',
          durationSec: audio.durationSec,
          utterances: result.utterances,
          processing: { ...options, elapsedMs: performance.now() - startedAt }
        }
      })
    } catch (error) {
      const message = toMessage(error)
      // 중단은 오류가 아니다. 녹음은 남아 있으니 다시 만들 수 있는 상태로 돌린다
      await patch({
        id: meeting.id,
        patch:
          message === ABORT_MESSAGE
            ? { status: 'recorded' }
            : { status: 'error', errorMessage: message }
      })
    } finally {
      abortRef.current = null
      setJob(null)
    }
  }

  const value: JobContextValue = {
    job,
    start: (meeting) => {
      if (abortRef.current) return
      void run(meeting)
    },
    cancel: () => abortRef.current?.abort()
  }

  return <JobContext.Provider value={value}>{children}</JobContext.Provider>
}
