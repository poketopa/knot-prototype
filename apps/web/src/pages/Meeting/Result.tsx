import { useState } from 'react'
import { useNavigate } from 'react-router'

import { formatTimestamp, formatTranscript, resolveSpeakerNames } from '@meeting-stt/core/format'

import Button from '../../components/Button'
import Icon from '../../components/Icon'
import { accelerationLabel } from '../../lib/autoOptions'
import { formatFullDate } from '../../lib/dateFormat'
import { downloadBlob } from '../../lib/download'
import { speakerColorOf } from '../../lib/speakerColors'
import { PATHS } from '../../routes/paths'
import { useMeetings } from '../../state/meetingsContext'
import TopBar from '../../shell/TopBar'
import type { MeetingRecord } from '../../types/meeting'
import InlineEditText from './InlineEditText'
import styles from './Result.module.css'

interface ResultProps {
  meeting: MeetingRecord
}

/** "복사했습니다" 표시가 사라질 때까지 */
const COPIED_FEEDBACK_MS = 1600

type CopyKind = 'plain' | 'markdown'

export default function Result({ meeting }: ResultProps) {
  const [copied, setCopied] = useState<CopyKind | null>(null)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const navigate = useNavigate()
  const { patch, remove } = useMeetings()

  const labels = meeting.utterances.map((utterance) => utterance.speakerLabel)
  const names = resolveSpeakerNames({ labels, displayNames: meeting.speakerNames })
  const speakerOrder = Object.keys(names)
  const utteranceCountOf = (label: string) =>
    meeting.utterances.filter((utterance) => utterance.speakerLabel === label).length

  const transcriptText = (format: CopyKind) =>
    formatTranscript({
      utterances: meeting.utterances,
      displayNames: meeting.speakerNames,
      format
    })

  const handleCopy = async (format: CopyKind) => {
    try {
      await navigator.clipboard.writeText(transcriptText(format))
      setCopied(format)
      setTimeout(() => setCopied(null), COPIED_FEEDBACK_MS)
    } catch {
      setActionError('클립보드에 복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요')
    }
  }

  const handleSaveText = () =>
    downloadBlob({
      blob: new Blob([transcriptText('plain')], { type: 'text/plain;charset=utf-8' }),
      fileName: `${meeting.title}.txt`
    })

  const handleRename = async (title: string) => {
    try {
      await patch({ id: meeting.id, patch: { title } })
    } catch {
      setActionError('제목을 저장하지 못했습니다')
    }
  }

  const handleRenameSpeaker = async ({ label, name }: { label: string; name: string }) => {
    try {
      await patch({
        id: meeting.id,
        patch: { speakerNames: { ...meeting.speakerNames, [label]: name } }
      })
    } catch {
      setActionError('화자 이름을 저장하지 못했습니다')
    }
  }

  const handleDelete = async () => {
    try {
      await remove(meeting.id)
      void navigate(PATHS.home, { replace: true })
    } catch {
      setActionError('기록을 지우지 못했습니다')
    }
  }

  return (
    <>
      <TopBar title="이전 기록">
        <Button variant="secondary" size="sm" onClick={() => void handleCopy('plain')}>
          <Icon name="copy" size={14} />
          {copied === 'plain' ? '복사했습니다' : '전체 복사'}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void handleCopy('markdown')}>
          {copied === 'markdown' ? '복사했습니다' : '마크다운으로 복사'}
        </Button>
        <Button variant="secondary" size="sm" onClick={handleSaveText}>
          텍스트 파일로 저장
        </Button>
        <div className={styles.more}>
          <Button
            variant="secondary"
            size="sm"
            aria-label="기록 더보기 (삭제)"
            aria-expanded={isMenuOpen}
            onClick={() => {
              setIsMenuOpen((open) => !open)
              setIsConfirmingDelete(false)
            }}
          >
            <Icon name="more" size={16} />
          </Button>
          {isMenuOpen ? (
            <div className={styles.menu} role="group" aria-label="기록 관리">
              {isConfirmingDelete ? (
                <>
                  <span className={styles.menuCaption}>
                    이 기록과 녹음을 지웁니다. 되돌릴 수 없습니다
                  </span>
                  <div className={styles.menuActions}>
                    <Button variant="danger" size="sm" onClick={() => void handleDelete()}>
                      <Icon name="trash" size={14} />
                      지우기
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setIsConfirmingDelete(false)}
                    >
                      취소
                    </Button>
                  </div>
                </>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => setIsConfirmingDelete(true)}>
                  <Icon name="trash" size={14} />
                  기록 지우기
                </Button>
              )}
            </div>
          ) : null}
        </div>
      </TopBar>

      <div className={styles.body}>
        <section aria-label="회의록" className={styles.transcript}>
          <header className={styles.header}>
            <h1 className={styles.title}>
              <InlineEditText
                value={meeting.title}
                label="회의 제목"
                onCommit={(t) => void handleRename(t)}
              />
            </h1>
            <p className={styles.meta}>
              <span>{formatFullDate(meeting.createdAt)}</span>
              <span aria-hidden="true">·</span>
              <span className={styles.mono}>
                {formatTimestamp({ sec: meeting.durationSec }).slice(3)}
              </span>
              <span aria-hidden="true">·</span>
              <span>화자 {speakerOrder.length}명</span>
            </p>
            {actionError ? <p className={styles.error}>{actionError}</p> : null}
          </header>

          {meeting.utterances.length === 0 ? (
            <p className={styles.empty}>
              알아들은 말이 없습니다. 녹음에 음성이 담겼는지 확인해 주세요.
            </p>
          ) : null}

          <ol className={styles.utterances}>
            {meeting.utterances.map((utterance) => (
              <li key={utterance.ord} className={styles.utterance}>
                <span className={styles.time}>
                  {formatTimestamp({ sec: utterance.startSec }).slice(3)}
                </span>
                <div className={styles.utteranceBody}>
                  <span
                    className={styles.speaker}
                    style={{ color: speakerColorOf(speakerOrder.indexOf(utterance.speakerLabel)) }}
                  >
                    <span className={styles.speakerDot} aria-hidden="true" />
                    {names[utterance.speakerLabel]}
                  </span>
                  <p className={styles.text}>{utterance.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <aside className={styles.rail}>
          <section aria-label="화자" className={styles.card}>
            <h2 className={styles.cardTitle}>화자</h2>
            {speakerOrder.map((label, index) => (
              <div key={label} className={styles.speakerRow}>
                <span
                  className={styles.speakerRowDot}
                  style={{ background: speakerColorOf(index) }}
                  aria-hidden="true"
                />
                <InlineEditText
                  className={styles.speakerName}
                  value={names[label]}
                  label={`${names[label]} 이름`}
                  onCommit={(name) => void handleRenameSpeaker({ label, name })}
                />
                <span className={styles.speakerCount}>발화 {utteranceCountOf(label)}</span>
              </div>
            ))}
          </section>

          <section aria-label="처리 정보" className={styles.infoCard}>
            <h2 className={styles.cardTitle}>처리 정보</h2>
            <dl className={styles.info}>
              <dt>음성 인식</dt>
              <dd>{meeting.processing?.whisperModel ?? '—'}</dd>
              <dt>가속</dt>
              <dd>{meeting.processing ? accelerationLabel(meeting.processing.sttDevice) : '—'}</dd>
              <dt>저장 위치</dt>
              <dd>이 브라우저</dd>
            </dl>
          </section>
        </aside>
      </div>
    </>
  )
}
