import { MAX_SPEAKER_COUNT, MIN_SPEAKER_COUNT } from '@meeting-stt/core/speakerCount'

import Button from '../components/Button'
import ProgressBar from '../components/ProgressBar'
import Stepper from '../components/Stepper'
import type { DeviceKind, DtypeKind, WhisperModelKind } from '../pipeline/messages'
import type { PipelineProgress } from '../pipeline/runPipeline'
import { STAGE_LABELS } from '../lib/stageLabels'

export interface RunOptions {
  /** 입력 중인 문자열. 비었거나 범위 밖이면 실행 버튼이 꺼진다 */
  speakerCountText: string
  sttDevice: DeviceKind
  sttDtype: DtypeKind
  whisperModel: WhisperModelKind
  diarizeDevice: DeviceKind
}

interface RunPanelProps {
  options: RunOptions
  progress: PipelineProgress | null
  isRunning: boolean
  isReady: boolean
  isSpeakerCountValid: boolean
  errorMessage: string | null
  onChange: (options: RunOptions) => void
  onRun: () => void
  onCancel: () => void
}

export default function RunPanel({
  options,
  progress,
  isRunning,
  isReady,
  isSpeakerCountValid,
  errorMessage,
  onChange,
  onRun,
  onCancel
}: RunPanelProps) {
  return (
    <section className="panel">
      <h2>실행</h2>

      <div className="options">
        <div className="option">
          <label htmlFor="speaker-count">참석자 수</label>
          <Stepper
            id="speaker-count"
            label="참석자 수"
            value={options.speakerCountText}
            min={MIN_SPEAKER_COUNT}
            max={MAX_SPEAKER_COUNT}
            placeholder="필수"
            isInvalid={!isSpeakerCountValid}
            onChange={(text) => onChange({ ...options, speakerCountText: text })}
          />
        </div>

        <label>
          STT 장치
          <select
            value={options.sttDevice}
            disabled={isRunning}
            onChange={(event) =>
              onChange({ ...options, sttDevice: event.target.value as DeviceKind })
            }
          >
            <option value="webgpu">WebGPU</option>
            <option value="wasm">WASM</option>
          </select>
        </label>

        <label>
          Whisper 모델
          <select
            value={options.whisperModel}
            disabled={isRunning}
            onChange={(event) =>
              onChange({ ...options, whisperModel: event.target.value as WhisperModelKind })
            }
          >
            <option value="large-v3-turbo">large-v3-turbo</option>
            <option value="small">small</option>
            <option value="tiny">tiny (동작 확인용)</option>
          </select>
        </label>

        <label>
          STT 정밀도
          <select
            value={options.sttDtype}
            disabled={isRunning}
            onChange={(event) =>
              onChange({ ...options, sttDtype: event.target.value as DtypeKind })
            }
          >
            <option value="q4f16">q4f16</option>
            <option value="q4">q4</option>
            <option value="fp32">fp32</option>
          </select>
        </label>

        <label>
          화자 분리 장치
          <select
            value={options.diarizeDevice}
            disabled={isRunning}
            onChange={(event) =>
              onChange({ ...options, diarizeDevice: event.target.value as DeviceKind })
            }
          >
            <option value="wasm">WASM</option>
            <option value="webgpu">WebGPU</option>
          </select>
        </label>
      </div>

      <p className="hint">
        참석자 수는 {MIN_SPEAKER_COUNT}~{MAX_SPEAKER_COUNT}명으로 넣는다. 고정하지 않으면 긴
        녹음에서 화자가 무한정 늘어난다 (docs/phase1-results.md).
      </p>

      <div className="actions">
        <Button onClick={onRun} disabled={!isReady || !isSpeakerCountValid || isRunning}>
          회의록 만들기
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={!isRunning}>
          중단
        </Button>
      </div>

      {progress ? (
        <div className="progress">
          <ProgressBar percent={progress.percent} label="회의록 만드는 중" />
          <p>
            [{STAGE_LABELS[progress.stage]}] {progress.note} — {progress.percent.toFixed(1)}%
          </p>
        </div>
      ) : null}

      {errorMessage ? <p className="error">{errorMessage}</p> : null}
    </section>
  )
}
