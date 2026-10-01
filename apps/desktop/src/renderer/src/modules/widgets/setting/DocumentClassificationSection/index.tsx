import { useEffect, useState } from 'react'
import {
  getDocumentClassificationStateApi,
  onPrototypeChanged,
  startDocumentClassificationApi
} from '@renderer/shared/api/prototype'
import type { DocumentClassificationState } from '@shared/prototype'
import useRecordingState from '@renderer/shared/hooks/domain/recording/useRecordingState'
import SettingGroup from '@renderer/shared/components/primitives/layout/SettingGroup'
import Button from '@renderer/shared/components/primitives/ui/Button'

import styles from './index.module.css'

const stateText = (state: DocumentClassificationState) => {
  if (state.status === 'running') return '문서 분류를 다시 계산하는 중입니다.'
  if (state.status === 'completed') {
    return `문서 분류가 끝났습니다.${typeof state.documentCount === 'number' ? ` ${state.documentCount}개 문서를 확인했어요.` : ''}`
  }
  if (state.status === 'failed') return `문서 분류에 실패했습니다. ${state.error ?? ''}`.trim()
  return '문서 폴더 분류만 다시 계산할 수 있습니다.'
}

export default function DocumentClassificationSection() {
  const { isRecording } = useRecordingState()
  const [state, setState] = useState<DocumentClassificationState>({ status: 'idle' })
  const [isLoading, setIsLoading] = useState(true)

  const refresh = async () => {
    try {
      setState(await getDocumentClassificationStateApi())
    } catch (caught) {
      setState({
        status: 'failed',
        error: caught instanceof Error ? caught.message : String(caught)
      })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    let isMounted = true
    const guardedRefresh = async () => {
      try {
        const next = await getDocumentClassificationStateApi()
        if (isMounted) setState(next)
      } catch (caught) {
        if (isMounted) {
          setState({
            status: 'failed',
            error: caught instanceof Error ? caught.message : String(caught)
          })
        }
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }
    void guardedRefresh()
    const unsubscribe = onPrototypeChanged(({ reason }) => {
      if (reason === 'documents' || reason === 'sync' || reason === 'auth') void guardedRefresh()
    })
    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [])

  const start = async () => {
    setState({ status: 'running', documentCount: state.documentCount })
    try {
      setState(await startDocumentClassificationApi())
    } catch (caught) {
      setState({
        status: 'failed',
        error: caught instanceof Error ? caught.message : String(caught)
      })
    } finally {
      await refresh()
    }
  }

  const isRunning = state.status === 'running'
  const isDisabled = isRecording || isRunning || isLoading

  return (
    <SettingGroup title="문서 분류">
      <div className={styles.body}>
        <p className={styles.hint}>
          기존 문서의 내용은 다시 쓰지 않고, 문서가 속한 큰 폴더 분류만 다시 계산합니다.
        </p>
        <p className={styles.status} role={isRunning ? 'status' : undefined}>
          {isLoading ? '문서 분류 상태를 확인하고 있습니다.' : stateText(state)}
        </p>
        {isRecording && (
          <p className={styles.warning} role="status">
            녹음 중에는 문서 분류를 다시 실행할 수 없습니다.
          </p>
        )}
        {state.status === 'failed' && (
          <p className={styles.error} role="alert">
            제목·본문·원문은 보존됩니다. 통신 오류라면 다시 실행하여 서버 반영 여부를 확인해 주세요.
          </p>
        )}
        <div className={styles.actions}>
          <Button variant="secondary" size="sm" onClick={() => void start()} disabled={isDisabled}>
            {isRunning ? '분류 중…' : '문서 분류 다시 실행'}
          </Button>
          {isRunning && <span className={styles.hint}>완료될 때까지 중복 실행할 수 없습니다.</span>}
        </div>
      </div>
    </SettingGroup>
  )
}
