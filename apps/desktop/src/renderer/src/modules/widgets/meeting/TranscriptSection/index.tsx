import { useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useNavigate } from 'react-router'
import PipelineProgress from '@renderer/modules/features/pipeline/PipelineProgress'
import TopBar from '@renderer/shared/components/primitives/layout/TopBar'
import useNow from '@renderer/shared/hooks/common/useNow'
import useMeeting from '@renderer/shared/hooks/domain/meeting/useMeeting'
import { PATHS } from '@renderer/shared/routes/paths'
import {
  MEETING_DATE_GROUP_LABELS,
  meetingDateGroupOf
} from '@renderer/shared/utils/meetingDateGroup'

import useRailResize from './model/useRailResize'
import useTranscriptCopy from './model/useTranscriptCopy'
import Placeholder from './ui/Placeholder'
import RailResizer from './ui/RailResizer'
import SpeakerPanel from './ui/SpeakerPanel'
import TranscriptActions from './ui/TranscriptActions'
import TranscriptHeader from './ui/TranscriptHeader'
import UtteranceRow from './ui/UtteranceRow'
import { toSpeakerOptions } from './utils/toSpeakerOptions'
import styles from './index.module.css'

const NOW_REFRESH_MS = 60_000
const TOP_BAR_TITLE = '회의록'

interface TranscriptSectionProps {
  meetingId: string
  /** 오른쪽 레일 위쪽에 끼울 내용. 상세 화면은 요약을 넣는다 */
  aside?: ReactNode
}

/**
 * 회의 상세의 본문 전체(상단 바 + 회의록 + 오른쪽 레일). 화자 목록이 회의록과 같은 `useMeeting` 상태를 써야 해서
 * 레일까지 여기서 그린다 (references/architecture.md "화면별 구성").
 */
export default function TranscriptSection({ meetingId, aside }: TranscriptSectionProps) {
  const navigate = useNavigate()
  const { now } = useNow({ intervalMs: NOW_REFRESH_MS })
  const {
    meeting,
    utterances,
    speakers,
    isLoading,
    error,
    saveError,
    renameMeeting,
    editUtteranceText,
    reassignUtterance,
    renameSpeaker,
    mergeSpeakers,
    removeMeeting
  } = useMeeting({ meetingId })

  const speakerOptions = toSpeakerOptions({ speakers, utterances })
  const speakerNames = Object.fromEntries(speakerOptions.map(({ label, name }) => [label, name]))
  const { copiedKey, copyError, copyAll, copyUtterance } = useTranscriptCopy({
    utterances,
    speakerNames
  })
  const contentRef = useRef<HTMLDivElement>(null)
  const { railWidth, isResizing, startResize, moveResize, endResize, resizeByKey, resetWidth } =
    useRailResize({ containerRef: contentRef })

  if (isLoading && !meeting) {
    return <Placeholder title={TOP_BAR_TITLE} message="회의를 불러오는 중입니다" />
  }
  if (error) return <Placeholder title={TOP_BAR_TITLE} message={error.message} isError />
  if (!meeting) return <Placeholder title={TOP_BAR_TITLE} message="회의를 찾을 수 없습니다" />

  const actionError = saveError ?? copyError
  const groupLabel =
    MEETING_DATE_GROUP_LABELS[meetingDateGroupOf({ epochMs: meeting.createdAt, now })]

  const handleDelete = async () => {
    if (await removeMeeting()) navigate(PATHS.home)
  }

  const renderBody = () => {
    if (meeting.status === 'recording') {
      return <p className={styles.message}>녹음이 진행 중입니다</p>
    }

    if (meeting.status === 'processing') {
      return (
        <div className={styles.pending}>
          <p className={styles.message}>
            회의록을 만들고 있습니다. 시간이 걸릴 수 있으니 잠시만 기다려 주세요
          </p>
          <PipelineProgress meetingId={meetingId} />
        </div>
      )
    }

    if (meeting.status === 'error') {
      return <p className={styles.error}>{meeting.errorMessage ?? '회의록을 만들지 못했습니다'}</p>
    }

    if (!utterances.length) return <p className={styles.message}>인식된 발화가 없습니다</p>

    return (
      <ol className={styles.list}>
        {utterances.map((utterance) => (
          <UtteranceRow
            key={utterance.id}
            utterance={utterance}
            speakerOptions={speakerOptions}
            isCopied={copiedKey === utterance.id}
            onChangeSpeaker={reassignUtterance}
            onCommitText={editUtteranceText}
            onCopy={copyUtterance}
          />
        ))}
      </ol>
    )
  }

  return (
    <>
      <TopBar title={`${TOP_BAR_TITLE} · ${groupLabel}`}>
        <TranscriptActions
          isCopyEnabled={utterances.length > 0}
          copiedKey={copiedKey}
          onCopy={copyAll}
          onDelete={handleDelete}
        />
      </TopBar>
      <div
        ref={contentRef}
        className={styles.content}
        data-resizing={isResizing}
        // 끈 폭은 런타임 값이라 CSS 변수 기본값(assets/layout.css)을 인라인으로 덮어쓴다
        style={{ '--rail-width': `${railWidth}px` } as CSSProperties}
      >
        <section className={styles.transcript} aria-label="회의록">
          <TranscriptHeader
            meeting={meeting}
            speakerCount={speakerOptions.length}
            onRenameTitle={(title) => renameMeeting({ title })}
          />
          {actionError ? (
            <p className={styles.error} role="alert">
              {actionError.message}
            </p>
          ) : null}
          {renderBody()}
        </section>
        <RailResizer
          railWidth={railWidth}
          isResizing={isResizing}
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerEnd={endResize}
          onKeyDown={resizeByKey}
          onReset={resetWidth}
        />
        <aside className={styles.rail}>
          {aside}
          {utterances.length ? (
            <SpeakerPanel
              speakerOptions={speakerOptions}
              utterances={utterances}
              onRenameSpeaker={renameSpeaker}
              onMergeSpeakers={mergeSpeakers}
            />
          ) : null}
        </aside>
      </div>
    </>
  )
}
