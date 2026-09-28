/**
 * 리디자인 화면에는 장치·모델·정밀도 선택이 없다. 환경을 보고 자동으로 정한다 (계획 §10 "실행 옵션").
 * 손으로 바꿔 재야 할 때는 `/test`를 쓴다.
 */

import type { DtypeKind, WhisperModelKind } from '@meeting-stt/models/web'

import type { DeviceKind } from '../pipeline/messages'
import type { WebGpuInfo } from './webgpu'

export interface AutoOptions {
  whisperModel: WhisperModelKind
  sttDevice: DeviceKind
  sttDtype: DtypeKind
  diarizeDevice: DeviceKind
}

/** 모델 파일을 처음 받을 때 화면에 알려 주는 대략적인 크기 (q4f16 기준, 계획 §6) */
export const MODEL_DOWNLOAD_MB = 600

export const pickAutoOptions = (webGpu: WebGpuInfo): AutoOptions => {
  if (!webGpu.isAvailable) {
    return {
      whisperModel: 'large-v3-turbo',
      sttDevice: 'wasm',
      sttDtype: 'q4',
      diarizeDevice: 'wasm'
    }
  }

  return {
    whisperModel: 'large-v3-turbo',
    sttDevice: 'webgpu',
    sttDtype: webGpu.hasShaderF16 ? 'q4f16' : 'q4',
    diarizeDevice: 'webgpu'
  }
}

export const accelerationLabel = (device: DeviceKind) => (device === 'webgpu' ? 'WebGPU' : 'WASM')
