import Button from '../../components/Button'
import Icon from '../../components/Icon'
import ProgressBar from '../../components/ProgressBar'
import { formatDurationWords } from '../../lib/dateFormat'
import { JOB_STEPS } from '../../state/jobProgress'
import { useJob, type JobState, type JobStep, type JobStepState } from '../../state/jobContext'
import TopBar from '../../shell/TopBar'
import type { MeetingRecord } from '../../types/meeting'
import styles from './Processing.module.css'

interface ProcessingProps {
  meeting: MeetingRecord
  /** 이 기록을 처리 중인 잡. 없으면 아직 시작 전이거나 실패한 상태다 */
  job: JobState | null
}

const STEP_TITLES: Record<JobStep, string> = {
  diarize: '화자 구분',
  stt: '음성 인식',
  merge: '회의록 정리'
}

const stepDescription = ({ step, meeting }: { step: JobStep; meeting: MeetingRecord }) => {
  if (step === 'diarize') return `참석자 ${meeting.speakerCount}명으로 나눕니다`
  if (step === 'stt') return '말한 내용을 글로 옮깁니다'

  return '같은 사람이 이어 말한 부분을 문단으로 묶습니다'
}

interface StepRowProps {
  title: string
  description: string
  state: JobStepState | null
  isDownloadExpected: boolean
}

function StepMarker({ status }: { status: JobStepState['status'] | 'saved' }) {
  if (status === 'done' || status === 'saved') {
    return (
      <span className={styles.markerDone}>
        <Icon name="check" size={14} />
      </span>
    )
  }
  if (status === 'waiting') return <span className={styles.markerWaiting} />

  return (
    <span className={styles.markerActive}>
      <span className={styles.markerInner} />
    </span>
  )
}

function StepRow({ title, description, state, isDownloadExpected }: StepRowProps) {
  const status = state?.status ?? 'waiting'
  const isActive = status === 'downloading' || status === 'running'
  const isDownloading = status === 'downloading'

  return (
    <li className={styles.step}>
      <StepMarker status={status} />
      <div className={styles.stepBody}>
        <div className={styles.stepHead}>
          <span
            className={isActive || status === 'done' ? styles.stepTitle : styles.stepTitleMuted}
          >
            {isDownloading
              ? `${title} 모델 받기${isDownloadExpected ? ' · 처음 한 번' : ''}`
              : title}
          </span>
          {status === 'done' ? <span className={styles.stepDone}>완료</span> : null}
          {status === 'waiting' ? <span className={styles.stepCaption}>대기</span> : null}
          {isActive && state ? (
            <span className={styles.stepPercent}>{Math.round(state.percent)}%</span>
          ) : null}
        </div>
        <span className={styles.stepCaption}>
          {isActive && state?.note ? state.note : description}
          {isDownloading ? ' — 다음 녹음부터는 저장해 둔 모델로 바로 시작합니다' : ''}
        </span>
        {isActive && state ? (
          <ProgressBar percent={state.percent} label={`${title} 진행률`} />
        ) : null}
      </div>
    </li>
  )
}

export default function Processing({ meeting, job }: ProcessingProps) {
  const { start, cancel } = useJob()
  const isIdle = job === null
  const isError = isIdle && meeting.status === 'error'

  return (
    <>
      <TopBar title={meeting.title}>
        {job ? (
          <Button variant="secondary" size="sm" onClick={cancel}>
            취소
          </Button>
        ) : null}
      </TopBar>
      <div className={styles.body}>
        <div className={styles.column}>
          <div className={styles.headline}>
            <h1 className={styles.title}>
              {job
                ? '회의록을 만드는 중'
                : isError
                  ? '회의록을 만들지 못했습니다'
                  : '녹음이 저장돼 있습니다'}
            </h1>
            {job ? (
              <>
                <div className={styles.overall}>
                  <span>전체 진행률</span>
                  <span className={styles.overallPercent}>{job.overallPercent}%</span>
                </div>
                <ProgressBar percent={job.overallPercent} label="전체 진행률" />
              </>
            ) : (
              <p className={styles.lead}>
                {isError
                  ? (meeting.errorMessage ?? '알 수 없는 오류')
                  : '처리 중에 탭을 닫았거나 취소했습니다. 저장된 녹음으로 다시 만들 수 있습니다.'}
              </p>
            )}
          </div>

          <ol className={styles.steps}>
            <li className={styles.step}>
              <StepMarker status="saved" />
              <div className={styles.stepBody}>
                <div className={styles.stepHead}>
                  <span className={styles.stepTitle}>녹음 저장</span>
                  <span className={styles.stepDone}>완료</span>
                </div>
                <span className={styles.stepCaption}>
                  {meeting.durationSec > 0
                    ? `${formatDurationWords(meeting.durationSec)} · 이 브라우저에 저장했습니다`
                    : `${meeting.audioName} · 이 브라우저에 저장했습니다`}
                </span>
              </div>
            </li>
            {JOB_STEPS.map((step) => (
              <StepRow
                key={step}
                title={STEP_TITLES[step]}
                description={stepDescription({ step, meeting })}
                state={job?.steps[step] ?? null}
                isDownloadExpected={job?.isDownloadExpected ?? false}
              />
            ))}
          </ol>

          {isIdle ? (
            <div className={styles.actions}>
              <Button onClick={() => start(meeting)}>
                {isError ? '다시 만들기' : '회의록 만들기'}
              </Button>
            </div>
          ) : null}

          <div role="status" className={styles.notice}>
            <Icon name="info" size={16} />
            <span>
              처리는 이 기기에서 합니다. 끝날 때까지 이 탭을 열어 두세요. 탭을 닫아도 녹음은 남아
              있어서 다시 열면 이어서 만들 수 있습니다.
            </span>
          </div>
        </div>
      </div>
    </>
  )
}
