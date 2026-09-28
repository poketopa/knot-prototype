import { useState } from 'react'
import { MAX_SPEAKER_COUNT, MIN_SPEAKER_COUNT } from '@meeting-stt/core/speakerCount'
import { formatAccelerator } from '@shared/shortcut'
import { controlRecordingApi } from '@renderer/shared/api/recording'
import Button from '@renderer/shared/components/primitives/ui/Button'
import LevelWaveform from '@renderer/shared/components/primitives/ui/LevelWaveform'
import Stepper from '@renderer/shared/components/primitives/ui/Stepper'
import useRecordingState from '@renderer/shared/hooks/domain/recording/useRecordingState'
import useSpeakerCount from '@renderer/shared/hooks/domain/recording/useSpeakerCount'
import useSettings from '@renderer/shared/hooks/domain/setting/useSettings'
import { formatClock } from '@renderer/shared/utils/formatClock'

import styles from './index.module.css'

const WAVEFORM_BAR_COUNT = 32
const CONTROL_ERROR_MESSAGE = '녹음 요청을 보내지 못했습니다. 잠시 후 다시 시도해 주세요'

/**
 * 메인 창의 녹음 화면. 상시 마운트된 컨트롤러가 오디오 그래프를 들고 있으므로 여기서는 명령을 보내고
 * 상태를 구독한다.
 */
export default function RecorderSection() {
  const { isRecording, levels, elapsedSec, speakerCount, errorMessage } = useRecordingState()
  const { text, isValid, changeText } = useSpeakerCount({ speakerCount })
  const { settings } = useSettings()
  const [controlError, setControlError] = useState<string | null>(null)

  const handleControl = async (kind: 'start' | 'stop') => {
    try {
      await controlRecordingApi({ kind })
      setControlError(null)
    } catch {
      setControlError(CONTROL_ERROR_MESSAGE)
    }
  }

  return (
    <section className={styles.section} aria-label="녹음">
      <div className={styles.controlStrip}>
        <div className={styles.statusArea}>
          <span className={isRecording ? styles.recordingStatus : styles.idleStatus}>
            <span className={styles.dot} aria-hidden="true" />
            {isRecording ? '녹음 중' : '대기 중'}
          </span>
        </div>
        <p
          className={[styles.elapsed, !isRecording ? styles.elapsedIdle : '']
            .filter(Boolean)
            .join(' ')}
        >
          {formatClock({ sec: elapsedSec })}
        </p>
        <div className={styles.waveform}>
          <LevelWaveform levels={levels} barCount={WAVEFORM_BAR_COUNT} size="sm" />
        </div>
        {isRecording ? (
          <Button className={styles.controlButton} onClick={() => handleControl('stop')}>
            <span className={styles.stopIcon} aria-hidden="true" />
            녹음 종료
          </Button>
        ) : (
          <Button
            variant="accent"
            className={styles.controlButton}
            onClick={() => handleControl('start')}
          >
            <span className={styles.startIcon} aria-hidden="true" />
            녹음 시작
          </Button>
        )}
      </div>

      <div className={styles.infoCard}>
        <div className={styles.intro}>
          <h1>지금의 대화를 기록해요</h1>
          <p>
            녹음이 끝나면 전사 원본과 AI 정리본을 저장하고, 주제별 문서에 결정과 남은 질문을
            누적합니다.
          </p>
        </div>

        <div className={styles.divider} />

        <div className={styles.speakerCount}>
          <div className={styles.speakerCountText}>
            <span className={styles.speakerCountTitle}>참석자 수</span>
            <span className={isValid ? styles.speakerCountHint : styles.error}>
              {isValid
                ? '알면 적어 주세요. 비우면 자동으로 나눕니다'
                : `${MIN_SPEAKER_COUNT}~${MAX_SPEAKER_COUNT} 사이의 정수만 쓸 수 있습니다`}
            </span>
          </div>
          <Stepper
            value={text}
            onChange={changeText}
            min={MIN_SPEAKER_COUNT}
            max={MAX_SPEAKER_COUNT}
            label="참석자 수"
            placeholder="모름"
            isInvalid={!isValid}
          />
          <Button variant="secondary" size="sm" disabled={!text} onClick={() => changeText('')}>
            모름
          </Button>
        </div>

        <div className={styles.cardFooter}>
          <span>창을 닫거나 다른 화면으로 옮겨도 녹음은 계속됩니다.</span>
          <span>
            {settings ? (
              <>
                <kbd className={styles.key}>{formatAccelerator(settings.recordingShortcut)}</kbd>
                로도 시작·정지할 수 있습니다.
              </>
            ) : (
              '메뉴바 아이콘으로도 시작·정지할 수 있습니다.'
            )}
          </span>
        </div>

        {controlError ? (
          <p className={styles.error} role="alert">
            {controlError}
          </p>
        ) : null}
        {errorMessage ? (
          <p className={styles.error} role="alert">
            {errorMessage}
          </p>
        ) : null}
      </div>
    </section>
  )
}
