import { Navigate } from 'react-router'

import { formatTimestamp } from '@meeting-stt/core/format'
import { MAX_SPEAKER_COUNT, MIN_SPEAKER_COUNT } from '@meeting-stt/core/speakerCount'

import LevelWaveform from '../../components/LevelWaveform'
import Stepper from '../../components/Stepper'
import { PATHS } from '../../routes/paths'
import { useRecording } from '../../state/recordingContext'
import TopBar from '../../shell/TopBar'
import { LEVEL_HISTORY_SIZE } from '../../ui/useRecorder'
import styles from './index.module.css'

export default function Record() {
  const recording = useRecording()

  // 녹음 중이 아닌데 URL로 들어오면 시작 화면으로. 정지 직후에는 기록 화면으로 이동 중이라 잠깐 남는다
  if (!recording.isRecording && !recording.isBusy) return <Navigate to={PATHS.home} replace />

  return (
    <>
      <TopBar title="새 녹음" />
      <div className={styles.body}>
        <div className={styles.timerBlock}>
          <span className={styles.status}>
            <span className={styles.statusDot} aria-hidden="true" />
            녹음 중
          </span>
          <p className={styles.timer}>{formatTimestamp({ sec: recording.elapsedSec }).slice(3)}</p>
        </div>

        <div className={styles.meter}>
          <LevelWaveform levels={recording.levels} barCount={LEVEL_HISTORY_SIZE} />
        </div>

        <div className={styles.speakerCard}>
          <span className={styles.speakerTitle}>참석자 수</span>
          <Stepper
            label="참석자 수"
            value={recording.speakerCountText}
            min={MIN_SPEAKER_COUNT}
            max={MAX_SPEAKER_COUNT}
            placeholder="명"
            isInvalid={recording.speakerCount === null}
            onChange={recording.setSpeakerCountText}
          />
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.stopButton}
            disabled={recording.isBusy || recording.speakerCount === null}
            onClick={() => void recording.stop()}
          >
            <span className={styles.stopSquare} aria-hidden="true" />
            녹음 정지하고 회의록 만들기
          </button>
          <p className={styles.hint}>
            녹음은 정지할 때 이 브라우저에 저장됩니다.
            <br />
            탭을 닫으면 녹음이 사라지니 회의가 끝날 때까지 열어 두세요.
          </p>
          {recording.errorMessage ? <p className={styles.error}>{recording.errorMessage}</p> : null}
        </div>
      </div>
    </>
  )
}
