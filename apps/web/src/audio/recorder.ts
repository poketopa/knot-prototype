/**
 * 마이크 녹음 (계획 §5 S6).
 *
 * `getUserMedia` → `AudioWorklet`으로 16kHz mono Float32 PCM을 직접 모은다. MediaRecorder는 쓰지 않는다 —
 * webm/opus로 압축돼 나오면 다시 디코딩해야 하고 STT 앞에 손실 압축이 한 겹 더 끼기 때문이다.
 * 정지하면 WAV `File`을 만들어, 드롭한 파일과 **같은 입구**(`loadAudio`)로 흘려보낸다.
 */

import workletUrl from './pcmRecorder.js?url'

import { SAMPLE_RATE_HZ } from '@meeting-stt/core/audio'
import { createPcmBlocks } from './pcmBlocks'
import { encodeWav, wavDurationSec } from './wav'

/** 워크릿이 한 번에 보내는 샘플 수. 16kHz에서 128ms — 레벨 미터가 초당 8번 갱신된다 */
const CHUNK_SAMPLES = 2048
const PROCESSOR_NAME = 'pcmRecorder'

const PERMISSION_MESSAGE =
  '마이크 사용 권한이 거부됐습니다. 주소창 왼쪽의 자물쇠에서 마이크를 허용한 뒤 다시 시도해 주세요'
const NOT_FOUND_MESSAGE = '마이크를 찾지 못했습니다. 입력 장치가 연결돼 있는지 확인해 주세요'

export interface Recording {
  file: File
  sampleRate: number
  durationSec: number
  sampleCount: number
}

interface StartRecorderParams {
  /** 청크마다 RMS(0~1)를 준다. 레벨 미터용 */
  onLevel: (level: number) => void
}

const rmsOf = (samples: Float32Array) => {
  let sumSquares = 0
  for (let i = 0; i < samples.length; i += 1) sumSquares += samples[i] * samples[i]

  return Math.sqrt(sumSquares / samples.length)
}

const toStartError = (caught: unknown) => {
  if (caught instanceof DOMException) {
    if (caught.name === 'NotAllowedError' || caught.name === 'SecurityError') {
      return new Error(PERMISSION_MESSAGE)
    }
    if (caught.name === 'NotFoundError' || caught.name === 'OverconstrainedError') {
      return new Error(NOT_FOUND_MESSAGE)
    }
  }

  return caught instanceof Error ? caught : new Error('녹음을 시작하지 못했습니다')
}

const toFileName = (startedAt: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = [
    startedAt.getFullYear(),
    pad(startedAt.getMonth() + 1),
    pad(startedAt.getDate()),
    '-',
    pad(startedAt.getHours()),
    pad(startedAt.getMinutes()),
    pad(startedAt.getSeconds())
  ].join('')

  return `녹음-${stamp}.wav`
}

/**
 * 마이크 → 워크릿 → 무음 싱크 그래프.
 * destination까지 잇지 않으면 워크릿의 `process()`가 한 번도 불리지 않고,
 * 게인을 0으로 두지 않으면 마이크 소리가 스피커로 되돌아간다 (계획 §7).
 */
const buildGraph = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
  })
  const context = new AudioContext({ sampleRate: SAMPLE_RATE_HZ })

  try {
    // 일부 장치는 요청한 샘플레이트를 무시한다. 48kHz를 16kHz라고 믿으면 전사가 통째로 어긋난다
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

    // getUserMedia를 기다리는 동안 사용자 제스처가 끊겨 suspended로 시작할 수 있다.
    // 그 상태면 워크릿의 process()가 돌지 않아 청크가 한 개도 오지 않는다
    if (context.state === 'suspended') await context.resume()

    return { context, stream, node }
  } catch (caught) {
    stream.getTracks().forEach((track) => track.stop())
    await context.close()
    throw caught
  }
}

export const startRecorder = async ({ onLevel }: StartRecorderParams) => {
  let graph: Awaited<ReturnType<typeof buildGraph>>

  try {
    graph = await buildGraph()
  } catch (caught) {
    throw toStartError(caught)
  }

  const blocks = createPcmBlocks()
  const startedAt = new Date()

  graph.node.port.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
    const chunk = new Float32Array(data)
    blocks.append(chunk)
    onLevel(rmsOf(chunk))
  }

  /** 청크가 더 날아오지 않게 그래프부터 끊는다 */
  const teardown = async () => {
    graph.node.port.onmessage = null
    graph.node.disconnect()
    graph.stream.getTracks().forEach((track) => track.stop())
    await graph.context.close()
  }

  const stop = async (): Promise<Recording> => {
    await teardown()

    const sampleCount = blocks.getSampleCount()
    const bytes = encodeWav({ blocks: blocks.toBlocks(), sampleRate: SAMPLE_RATE_HZ })

    return {
      file: new File([bytes], toFileName(startedAt), { type: 'audio/wav' }),
      sampleRate: SAMPLE_RATE_HZ,
      sampleCount,
      durationSec: wavDurationSec({ sampleCount, sampleRate: SAMPLE_RATE_HZ })
    }
  }

  return { stop, cancel: teardown }
}

export type Recorder = Awaited<ReturnType<typeof startRecorder>>
