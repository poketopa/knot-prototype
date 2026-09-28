import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { MAX_SPEAKER_COUNT, MIN_SPEAKER_COUNT } from '@meeting-stt/core/speakerCount'

import Icon from '../../components/Icon'
import Stepper from '../../components/Stepper'
import { MODEL_DOWNLOAD_MB, pickAutoOptions } from '../../lib/autoOptions'
import { defaultMeetingTitle } from '../../lib/dateFormat'
import { newMeetingId } from '../../lib/meetingStore'
import { probeModelCache, type ModelCacheInfo } from '../../lib/modelCache'
import { probeWebGpu, type WebGpuInfo } from '../../lib/webgpu'
import { meetingPath } from '../../routes/paths'
import { useJob } from '../../state/jobContext'
import { useMeetings } from '../../state/meetingsContext'
import { useRecording } from '../../state/recordingContext'
import TopBar from '../../shell/TopBar'
import type { MeetingRecord } from '../../types/meeting'
import styles from './index.module.css'

const modelCaption = (cache: ModelCacheInfo | null) => {
  if (!cache || !cache.isReadable) return `모델 약 ${MODEL_DOWNLOAD_MB}MB · 첫 녹음 때 받음`
  if (cache.cachedCount === cache.totalCount) return '모델 받아 둠 · 바로 시작'

  return `모델 약 ${MODEL_DOWNLOAD_MB}MB · 아직 받지 않음`
}

export default function Home() {
  const [webGpu, setWebGpu] = useState<WebGpuInfo | null>(null)
  const [modelCache, setModelCache] = useState<ModelCacheInfo | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const { save } = useMeetings()
  const { job, start: startJob } = useJob()
  const recording = useRecording()
  const isBlocked = recording.isRecording || recording.isBusy || job !== null
  const isSpeakerCountValid = recording.speakerCount !== null

  // 환경과 모델 캐시는 브라우저 API에 묻는 외부 동기화라 마운트 때 한 번만 본다
  useEffect(() => {
    let isActive = true

    void probeWebGpu().then(async (info) => {
      if (!isActive) return
      setWebGpu(info)

      const options = pickAutoOptions(info)
      const cache = await probeModelCache({
        whisperModel: options.whisperModel,
        sttDtype: options.sttDtype
      })
      if (isActive) setModelCache(cache)
    })

    return () => {
      isActive = false
    }
  }, [])

  const handleFile = async (file: File) => {
    if (recording.speakerCount === null) return

    setFileError(null)
    const createdAt = Date.now()
    const meeting: MeetingRecord = {
      id: newMeetingId(),
      title: file.name.replace(/\.[^.]+$/, '') || defaultMeetingTitle(createdAt),
      createdAt,
      // 길이는 파이프라인이 디코딩한 뒤 채운다
      durationSec: 0,
      speakerCount: recording.speakerCount,
      status: 'recorded',
      audio: file,
      audioName: file.name,
      utterances: [],
      speakerNames: {},
      processing: null,
      errorMessage: null
    }

    try {
      await save(meeting)
    } catch (error) {
      setFileError(
        `파일을 저장하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`
      )
      return
    }

    startJob(meeting)
    void navigate(meetingPath(meeting.id))
  }

  return (
    <>
      <TopBar title="새 녹음" />
      <div className={styles.body}>
        <div className={styles.hero}>
          <h1 className={styles.title}>
            녹음하면 이 브라우저 안에서
            <br />
            회의록이 됩니다
          </h1>
          <p className={styles.lead}>
            설치할 것은 없습니다. 녹음은 서버로 보내지 않고, 음성 인식 모델은 첫 녹음을 마칠 때 한
            번 받아 이 브라우저에 저장해 둡니다.
          </p>
        </div>

        <div className={styles.speakerCard}>
          <div className={styles.speakerText}>
            <span className={styles.speakerTitle}>참석자 수</span>
            <span className={styles.speakerHint}>
              화자를 나누려면 몇 명이 말하는지 알아야 합니다
            </span>
          </div>
          <Stepper
            label="참석자 수"
            value={recording.speakerCountText}
            min={MIN_SPEAKER_COUNT}
            max={MAX_SPEAKER_COUNT}
            placeholder="명"
            onChange={recording.setSpeakerCountText}
          />
        </div>

        <button
          type="button"
          className={styles.startButton}
          disabled={isBlocked || !isSpeakerCountValid}
          onClick={() => void recording.start()}
        >
          <span className={styles.startDot} aria-hidden="true" />
          녹음 시작
        </button>

        {recording.errorMessage ? <p className={styles.error}>{recording.errorMessage}</p> : null}
        {fileError ? <p className={styles.error}>{fileError}</p> : null}

        <div className={styles.facts}>
          {webGpu === null ? (
            <span>환경 확인 중</span>
          ) : webGpu.isAvailable ? (
            <span className={styles.gpuOk}>
              <Icon name="check" size={14} />
              <span className={styles.gpuText}>GPU 가속(WebGPU) 사용 가능</span>
            </span>
          ) : (
            <span>GPU 가속 없음 · CPU로 느리게 처리</span>
          )}
          <span aria-hidden="true">·</span>
          <span>{modelCaption(modelCache)}</span>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            className={styles.fileButton}
            disabled={isBlocked || !isSpeakerCountValid}
            onClick={() => fileInputRef.current?.click()}
          >
            오디오 파일로 시작
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void handleFile(file)
            }}
          />
        </div>
      </div>
    </>
  )
}
