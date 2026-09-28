import { Navigate, Outlet } from 'react-router'
import useModelStatus from '@renderer/shared/hooks/domain/model/useModelStatus'
import Button from '@renderer/shared/components/primitives/ui/Button'

import { PATHS } from './paths'

/** 최초 설정 후 모델을 변경하거나 파일이 사라졌으면 설정에서 다시 준비한다. */
export function RequireModels() {
  const { status, isLoading, error, refetch } = useModelStatus()

  if (isLoading && !status) return <p role="status">모델 상태를 확인하는 중입니다…</p>
  if (error || !status)
    return (
      <section>
        <p role="alert">모델 상태를 확인하지 못했습니다</p>
        <Button onClick={refetch}>다시 시도</Button>
      </section>
    )
  if (!status.isReady) return <Navigate to={PATHS.settings} replace />

  return <Outlet />
}
