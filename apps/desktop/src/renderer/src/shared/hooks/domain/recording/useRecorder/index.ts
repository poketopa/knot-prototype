import { useCallback, useEffect, useRef, useState } from 'react'
import { CHANNELS, CHUNK_SAMPLES, SAMPLE_RATE_HZ } from '@shared/audio'
import workletUrl from '@renderer/worklet/pcmRecorder.js?url'
import { onRecordingCommand } from '@renderer/shared/api/events'
import { getModelStatusApi } from '@renderer/shared/api/models'
import {
  reportRecordingErrorApi,
  requestMicrophonePermissionApi,
  sendRecordingChunkApi,
  startRecordingApi,
  stopRecordingApi
} from '@renderer/shared/api/recording'

const PROCESSOR_NAME = 'pcmRecorder'
const PERMISSION_DENIED_MESSAGE =
  '마이크 사용 권한이 없습니다. 시스템 설정에서 마이크 접근을 허용해 주세요'
const MODEL_NOT_READY_MESSAGE = '메인 창에서 모델을 먼저 준비해 주세요'

interface RecordingGraph {
  context: AudioContext
  stream: MediaStream
  node: AudioWorkletNode
}

interface UseRecorderParams {
  /** 모델이 준비됐는지. 준비 전에는 시작 요청을 막고 안내한다 */
  isReady: boolean
}

const messageOf = (caught: unknown) =>
  caught instanceof Error ? caught.message : '녹음 중 알 수 없는 오류가 발생했습니다'

/**
 * 마이크 → 워크릿 → 무음 싱크 그래프를 만든다.
 * destination까지 이어 두지 않으면 워크릿의 process()가 호출되지 않고,
 * 게인을 0으로 두지 않으면 마이크 소리가 스피커로 되돌아간다 (references/pitfalls.md).
 */
const buildGraph = async (): Promise<RecordingGraph> => {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: CHANNELS, echoCancellation: true, noiseSuppression: true }
  })
  const context = new AudioContext({ sampleRate: SAMPLE_RATE_HZ })

  try {
    if (context.sampleRate !== SAMPLE_RATE_HZ) {
      throw new Error(
        `이 마이크는 ${SAMPLE_RATE_HZ}Hz 녹음을 지원하지 않습니다 (현재 ${context.sampleRate}Hz)`
      )
    }

    await context.audioWorklet.addModule(workletUrl)
    const node = new AudioWorkletNode(context, PROCESSOR_NAME, {
      processorOptions: { chunkSamples: CHUNK_SAMPLES }
    })
    const silentSink = context.createGain()
    silentSink.gain.value = 0

    context.createMediaStreamSource(stream).connect(node)
    node.connect(silentSink).connect(context.destination)

    return { context, stream, node }
  } catch (caught) {
    stream.getTracks().forEach((track) => track.stop())
    await context.close()
    throw caught
  }
}

const closeGraph = async (graph: RecordingGraph) => {
  graph.node.port.onmessage = null
  graph.node.disconnect()
  graph.stream.getTracks().forEach((track) => track.stop())
  await graph.context.close()
}

/**
 * 오디오 그래프의 유일한 소유자인 메인 renderer 훅. 상태(녹음 중 여부·경과 시간·레벨)는
 * main 세션이 들고 있으므로 여기서는 그래프와 실패만 다룬다.
 */
const useRecorder = ({ isReady }: UseRecorderParams) => {
  const [isBusy, setIsBusy] = useState(false)
  const graphRef = useRef<RecordingGraph | null>(null)
  const meetingIdRef = useRef<string | null>(null)
  const isStartingRef = useRef(false)
  const isMountedRef = useRef(true)
  const lifecycleRef = useRef(0)

  /** 실패는 세션에 모아 두 창이 같은 안내를 본다 */
  const report = useCallback((message: string) => {
    reportRecordingErrorApi({ message }).catch(() =>
      console.error(`녹음 오류를 알리지 못했습니다: ${message}`)
    )
  }, [])

  /** 오디오 그래프를 먼저 끊어야 정지 요청 뒤에 청크가 더 날아가지 않는다 */
  const teardownGraph = useCallback(async () => {
    const graph = graphRef.current
    graphRef.current = null
    if (graph) await closeGraph(graph)
  }, [])

  const start = useCallback(async () => {
    if (graphRef.current || isStartingRef.current) return

    isStartingRef.current = true
    const lifecycle = lifecycleRef.current
    const isCurrentLifecycle = () => isMountedRef.current && lifecycleRef.current === lifecycle
    setIsBusy(true)

    try {
      if (!isReady) throw new Error(MODEL_NOT_READY_MESSAGE)
      if (!(await getModelStatusApi()).isReady) throw new Error(MODEL_NOT_READY_MESSAGE)
      if (!(await requestMicrophonePermissionApi())) throw new Error(PERMISSION_DENIED_MESSAGE)

      const graph = await buildGraph()
      if (!isCurrentLifecycle()) {
        await closeGraph(graph)
        return
      }

      try {
        const meetingId = await startRecordingApi({ sampleRate: graph.context.sampleRate })
        if (!isCurrentLifecycle()) {
          await closeGraph(graph)
          await stopRecordingApi({ meetingId })
          return
        }

        graph.node.port.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
          sendRecordingChunkApi({ meetingId, pcm: data }).catch((caught) =>
            report(messageOf(caught))
          )
        }
        graphRef.current = graph
        meetingIdRef.current = meetingId
      } catch (caught) {
        // main이 시작을 거절하면 마이크를 잡은 채로 두지 않는다
        await closeGraph(graph)
        throw caught
      }
    } catch (caught) {
      report(messageOf(caught))
    } finally {
      isStartingRef.current = false
      if (isMountedRef.current) setIsBusy(false)
    }
  }, [isReady, report])

  const stop = useCallback(async () => {
    const meetingId = meetingIdRef.current
    if (!meetingId) return

    setIsBusy(true)
    meetingIdRef.current = null

    try {
      await teardownGraph()
      await stopRecordingApi({ meetingId })
    } catch (caught) {
      report(messageOf(caught))
    } finally {
      setIsBusy(false)
    }
  }, [report, teardownGraph])

  // 다시 마운트되면 ref만 비워지고 이전 그래프가 마이크를 잡은 채 청크를 계속 보낸다.
  // 그래프를 잃은 녹음은 이어 갈 수 없으므로 여기서 정지까지 마친다 (references/pitfalls.md)
  useEffect(() => {
    isMountedRef.current = true
    lifecycleRef.current += 1
    const lifecycle = lifecycleRef.current

    return () => {
      if (lifecycleRef.current === lifecycle) lifecycleRef.current += 1
      isMountedRef.current = false
      const meetingId = meetingIdRef.current
      meetingIdRef.current = null

      void teardownGraph()
        .then(() => (meetingId ? stopRecordingApi({ meetingId }) : undefined))
        .catch((caught) => report(messageOf(caught)))
    }
  }, [report, teardownGraph])

  // 전역 단축키·Tray·메인 창의 지시는 main을 거쳐 그래프 소유자인 메인 renderer로 온다
  useEffect(
    () =>
      onRecordingCommand(({ kind }) => {
        const isActive = meetingIdRef.current !== null

        if (kind === 'stop' || (kind === 'toggle' && isActive)) void stop()
        else if (kind === 'start' || kind === 'toggle') void start()
      }),
    [start, stop]
  )

  return { isBusy, start, stop }
}

export default useRecorder
