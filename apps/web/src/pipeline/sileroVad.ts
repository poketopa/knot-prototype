/**
 * silero v5 VAD 실행.
 *
 * **함정**: v5는 창 512샘플만 넣으면 안 되고 직전 창의 끝 64샘플을 앞에 붙여 576샘플을 넣어야 한다
 * (silero-vad 저장소의 `OnnxWrapper`가 하는 일). 컨텍스트 없이 돌리면 창 앞머리의 STFT가 뭉개져
 * 발화 확률이 체계적으로 낮게 나온다 — 원거리 마이크 10분 녹음에서 발화가 383초 대신 175초로 잡혔다.
 */

import {
  AutoModel,
  Tensor,
  type PretrainedConfig,
  type ProgressCallback
} from '@huggingface/transformers'

import type { DeviceKind } from './messages'
import { VAD_MODEL_ID } from '@meeting-stt/models/web'

/** 16kHz에서 silero v5가 받는 창 크기 */
export const VAD_WINDOW_SAMPLES = 512
const VAD_CONTEXT_SAMPLES = 64
const VAD_STATE_SHAPE = [2, 1, 128]
const VAD_STATE_SIZE = 2 * 128

/** silero 저장소에는 config.json이 없다. 라이브러리가 런타임에 PretrainedConfig로 감싼다 */
const SILERO_CONFIG = { model_type: 'custom' } as unknown as PretrainedConfig

interface RunSileroVadParams {
  samples: Float32Array
  sampleRate: number
  device?: DeviceKind
  onDownload?: ProgressCallback
  onWindow?: (progress: { index: number; total: number }) => void
}

/** 창마다의 발화 확률. 후처리는 `vadSegments.ts`가 맡는다 */
export const runSileroVad = async ({
  samples,
  sampleRate,
  device,
  onDownload,
  onWindow
}: RunSileroVadParams) => {
  const model = await AutoModel.from_pretrained(VAD_MODEL_ID, {
    config: SILERO_CONFIG,
    dtype: 'fp32',
    device,
    progress_callback: onDownload
  })

  const sr = new Tensor('int64', [BigInt(sampleRate)], [])
  let state = new Tensor('float32', new Float32Array(VAD_STATE_SIZE), VAD_STATE_SHAPE)
  let context = new Float32Array(VAD_CONTEXT_SAMPLES)

  const probabilities: number[] = []
  const total = Math.floor(samples.length / VAD_WINDOW_SAMPLES)

  for (let index = 0; index < total; index += 1) {
    const offset = index * VAD_WINDOW_SAMPLES
    const chunk = new Float32Array(VAD_CONTEXT_SAMPLES + VAD_WINDOW_SAMPLES)
    chunk.set(context, 0)
    chunk.set(samples.subarray(offset, offset + VAD_WINDOW_SAMPLES), VAD_CONTEXT_SAMPLES)
    context = chunk.slice(chunk.length - VAD_CONTEXT_SAMPLES)

    const input = new Tensor('float32', chunk, [1, chunk.length])
    const output = (await model({ input, sr, state })) as { output: Tensor; stateN: Tensor }
    state = output.stateN
    probabilities.push(Number(output.output.data[0]))

    onWindow?.({ index, total })
  }

  await model.dispose()

  return { probabilities, windowSec: VAD_WINDOW_SAMPLES / sampleRate }
}
