/** 메인 스레드 ↔ 워커 메시지 계약. 두 워커가 같은 진행률·오류 모양을 쓴다 */

import type { SpeakerSegment, SttSegment } from '@meeting-stt/core/types'
import type { DtypeKind, WhisperModelKind } from '@meeting-stt/models/web'

/** 모델 종류·양자화는 카탈로그(`@meeting-stt/models/web`)가 정의한다. 기존 import 경로를 유지하려고 재노출한다 */
export type { DtypeKind, WhisperModelKind }

export type PipelineStage = 'decode' | 'diarize' | 'stt' | 'merge'

/** ONNX 실행 장치. 라이브러리가 쓰는 문자열과 같아야 한다 */
export type DeviceKind = 'webgpu' | 'wasm'

export interface DiarizeRequest {
  samples: Float32Array
  sampleRate: number
  speakerCount: number
  device: DeviceKind
}

export interface SttRequest {
  samples: Float32Array
  sampleRate: number
  device: DeviceKind
  dtype: DtypeKind
  whisperModel: WhisperModelKind
}

export interface WorkerProgressMessage {
  type: 'progress'
  /** 모델 내려받는 중인지, 추론 중인지 */
  kind: 'download' | 'run'
  percent: number
  note: string
}

export interface DiarizeDoneMessage {
  type: 'done'
  speakerSegments: SpeakerSegment[]
  /** 군집에 들어간 임베딩 수 — 창 경계에서 얼마나 잘게 잘렸는지 보는 값 */
  embeddingCount: number
  /** 다음 워커에 넘기려고 소유권을 돌려받는다 */
  samples: Float32Array
  elapsedMs: number
}

export interface SttDoneMessage {
  type: 'done'
  segments: SttSegment[]
  /** VAD가 남긴 발화 길이(초). RTF 계산의 분모가 아니라 참고값이다 */
  speechSec: number
  vadElapsedMs: number
  samples: Float32Array
  elapsedMs: number
}

export interface WorkerErrorMessage {
  type: 'error'
  message: string
}

export type DiarizeResponse = WorkerProgressMessage | DiarizeDoneMessage | WorkerErrorMessage
export type SttResponse = WorkerProgressMessage | SttDoneMessage | WorkerErrorMessage
