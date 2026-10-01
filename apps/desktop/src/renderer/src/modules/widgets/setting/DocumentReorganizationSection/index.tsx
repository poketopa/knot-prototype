import { useMemo, useState } from 'react'
import type { ReanalyzePrototypeDocumentsResponse } from '@shared/ipc'
import { reanalyzeDocumentsApi } from '@renderer/shared/api/prototype'
import useRecordingState from '@renderer/shared/hooks/domain/recording/useRecordingState'
import SettingGroup from '@renderer/shared/components/primitives/layout/SettingGroup'
import Button from '@renderer/shared/components/primitives/ui/Button'

import styles from './index.module.css'

type ReanalysisStatus =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'completed'; result: ReanalyzePrototypeDocumentsResponse }
  | { state: 'failed'; error: string; result?: ReanalyzePrototypeDocumentsResponse }

const resultLabel = (result: ReanalyzePrototypeDocumentsResponse) =>
  `${result.requested}개 중 ${result.processed}개 다시 정리, ${result.skipped}개 건너뜀`

const failureMessage = (result: ReanalyzePrototypeDocumentsResponse) => {
  if (result.failed === 0) return null
  const first = result.failures[0]
  return first
    ? `${result.failed}개 실패: ${first.title} — ${first.error}`
    : `${result.failed}개 실패`
}

const statusMessage = (status: ReanalysisStatus) => {
  if (status.state === 'idle') return '아직 실행하지 않았습니다.'
  if (status.state === 'running') return '기존 문서를 다시 정리하는 중입니다.'
  if (status.state === 'completed')
    return `로컬 재정리가 끝났습니다. 서버 반영은 연결 상태에 따라 이어서 진행됩니다. ${resultLabel(status.result)}`
  return `기존 문서 다시 정리에 실패했습니다. ${status.error}`
}

export default function DocumentReorganizationSection() {
  const { isRecording } = useRecordingState()
  const [status, setStatus] = useState<ReanalysisStatus>({ state: 'idle' })

  const isRunning = status.state === 'running'
  const isFailed = status.state === 'failed'
  const isDisabled = isRecording || isRunning
  const buttonLabel = useMemo(() => {
    if (isRunning) return '다시 정리 중…'
    if (isFailed) return '다시 시도'
    return '기존 문서 다시 정리'
  }, [isFailed, isRunning])

  const run = async () => {
    setStatus({ state: 'running' })
    try {
      const result = await reanalyzeDocumentsApi()
      const failed = failureMessage(result)
      if (failed) {
        setStatus({ state: 'failed', error: failed, result })
        return
      }
      setStatus({ state: 'completed', result })
    } catch (caught) {
      setStatus({
        state: 'failed',
        error: caught instanceof Error ? caught.message : String(caught)
      })
    }
  }

  return (
    <SettingGroup title="문서 관리">
      <div className={styles.body}>
        <p className={styles.hint}>
          현재 로그인한 사용자의 기존 문서를 지금 선택한 AI 정리 방식으로 다시 분석합니다. 실패해도
          기존 문서는 보존되며, 다시 시도할 수 있습니다. 기존 AI 처리나 발행이 진행 중인 녹음은 이번
          실행에서 제외됩니다.
        </p>
        <p className={styles.status} role={status.state === 'running' ? 'status' : undefined}>
          {statusMessage(status)}
        </p>
        {status.state === 'completed' && (
          <p className={styles.notice} role="status">
            완료된 내용은 문서 탭에서 확인할 수 있습니다.
          </p>
        )}
        {isRecording && (
          <p className={styles.warning} role="status">
            녹음 중에는 기존 문서를 다시 정리할 수 없습니다.
          </p>
        )}
        {status.state === 'failed' && (
          <p className={styles.error} role="alert">
            기존 문서는 그대로 보존되어 있습니다.
          </p>
        )}
        <div className={styles.actions}>
          <Button variant="secondary" size="sm" onClick={() => void run()} disabled={isDisabled}>
            {buttonLabel}
          </Button>
          {isRunning && (
            <span className={styles.hint}>완료될 때까지 다른 재정리는 시작할 수 없습니다.</span>
          )}
        </div>
      </div>
    </SettingGroup>
  )
}
