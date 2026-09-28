import { useId, useState } from 'react'
import { Link } from 'react-router'
import { LLM_PROVIDER_LABELS, llmMissingMessage } from '@shared/llm'
import Button from '@renderer/shared/components/primitives/ui/Button'
import Icon from '@renderer/shared/components/primitives/ui/Icon'
import ProgressBar from '@renderer/shared/components/primitives/ui/ProgressBar'
import useLlmStatus from '@renderer/shared/hooks/domain/llm/useLlmStatus'
import useMeeting from '@renderer/shared/hooks/domain/meeting/useMeeting'
import useSummary from '@renderer/shared/hooks/domain/meeting/useSummary'
import { PATHS } from '@renderer/shared/routes/paths'

import { STAGE_MESSAGES } from './constants/stage'
import useSummaryCopy from './model/useSummaryCopy'
import styles from './index.module.css'

interface SummarySectionProps {
  meetingId: string
}

const CHEVRON_SIZE = 14

export default function SummarySection({ meetingId }: SummarySectionProps) {
  const { meeting, utterances } = useMeeting({ meetingId })
  const { summary, stage, percent, error, isRunning, createSummary } = useSummary({
    meetingId,
    initialSummary: meeting?.summary
  })
  const { isCopied, copyError, copySummary } = useSummaryCopy({ summary })
  const { status: llmStatus } = useLlmStatus()
  const [isExpanded, setIsExpanded] = useState(true)
  const bodyId = useId()

  // 회의록이 아직 없으면 요약할 것도 없다
  if (meeting?.status !== 'done') return null

  const hasTranscript = utterances.length > 0
  // 상태를 아직 모르면 막지 않는다. 준비 문구는 main과 같은 함수로 만든다 (references/architecture.md "LLM 공급자")
  const missingMessage = llmStatus ? llmMissingMessage(llmStatus) : null
  const providerLabel = llmStatus ? LLM_PROVIDER_LABELS[llmStatus.provider] : ''
  // 접어 둔 채로 요약이 돌면 진행률이 안 보이므로 캡션이 대신 알려 준다
  const caption = !isExpanded && isRunning ? `요약 중 ${percent}%` : providerLabel

  const renderBody = () => {
    if (isRunning) {
      return (
        <div className={styles.pending}>
          <p className={styles.message}>{stage ? STAGE_MESSAGES[stage] : ''}</p>
          <ProgressBar percent={percent} label="요약 진행률" />
        </div>
      )
    }

    if (summary) return <p className={styles.summary}>{summary}</p>
    if (!hasTranscript) return <p className={styles.message}>요약할 발화가 없습니다</p>
    if (missingMessage) {
      return (
        <p className={styles.message}>
          {missingMessage}.{' '}
          <Link className={styles.link} to={PATHS.settings}>
            설정에서 준비하기
          </Link>
        </p>
      )
    }

    return (
      <p className={styles.message}>
        아직 요약이 없습니다. 회의록을 {providerLabel || '선택한 모델'}로 요약하며, 회의 길이에 따라
        몇 분이 걸립니다
      </p>
    )
  }

  return (
    <section className={styles.section} aria-label="회의 요약">
      {/* 헤더 전체가 접기 버튼이라 상단 어디를 눌러도 접힌다 */}
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={isExpanded}
        aria-controls={bodyId}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className={styles.chevron}>
          <Icon name="chevronDown" size={CHEVRON_SIZE} />
        </span>
        <h2 className={styles.title}>요약</h2>
        <span className={styles.caption}>{caption}</span>
      </button>

      {isExpanded && (
        <div id={bodyId} className={styles.body}>
          {renderBody()}

          {error && <p className={styles.error}>{error}</p>}
          {copyError && <p className={styles.error}>{copyError}</p>}

          <div className={styles.actions}>
            {summary && !isRunning && (
              <Button variant="secondary" size="sm" className={styles.action} onClick={copySummary}>
                {isCopied ? '복사됨' : '요약 복사'}
              </Button>
            )}
            <Button
              size="sm"
              className={styles.action}
              onClick={createSummary}
              disabled={isRunning || !hasTranscript || missingMessage !== null}
            >
              {summary ? '다시 요약' : '요약 만들기'}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
