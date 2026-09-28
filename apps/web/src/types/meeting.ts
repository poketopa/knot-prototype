/**
 * 이 브라우저에 저장되는 기록 한 개. IndexedDB에 그대로 들어간다 (계획 §10 "저장").
 * 오디오 Blob을 기록과 같이 두므로 처리 중 탭을 닫아도 다시 열어 이어서 만들 수 있다.
 */

import type { MergedUtterance } from '@meeting-stt/core/types'
import type { DtypeKind, WhisperModelKind } from '@meeting-stt/models/web'

import type { DeviceKind } from '../pipeline/messages'

export type MeetingStatus = 'recorded' | 'processing' | 'done' | 'error'

export interface ProcessingInfo {
  whisperModel: WhisperModelKind
  sttDevice: DeviceKind
  sttDtype: DtypeKind
  diarizeDevice: DeviceKind
  /** 화자 분리 + 음성 인식 + 병합에 걸린 시간 */
  elapsedMs: number
}

export interface MeetingRecord {
  id: string
  title: string
  /** epoch ms */
  createdAt: number
  durationSec: number
  speakerCount: number
  status: MeetingStatus
  /** 녹음한 WAV 또는 사용자가 고른 원본 파일 */
  audio: Blob
  audioName: string
  utterances: MergedUtterance[]
  /** 화자 라벨 → 사용자가 붙인 이름. 없으면 "화자 N" */
  speakerNames: Record<string, string>
  processing: ProcessingInfo | null
  errorMessage: string | null
}
