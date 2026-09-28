import type { ReactNode } from 'react'

import Badge, { type BadgeTone } from '../components/Badge'
import type { EnvironmentInfo } from '../lib/environment'
import type { ModelCacheInfo } from '../lib/modelCache'
import { formatGb } from '../lib/units'

interface EnvironmentPanelProps {
  environment: EnvironmentInfo | null
  modelCache: ModelCacheInfo | null
}

interface StatusProps {
  tone: BadgeTone
  label: string
  detail?: ReactNode
}

/** 상태는 배지로, 이유·대안은 옆의 회색 글자로. 빨강은 실행이 불가능할 때만 쓴다 */
function Status({ tone, label, detail }: StatusProps) {
  return (
    <>
      <Badge tone={tone}>{label}</Badge>
      {detail ? <span className="detail">{detail}</span> : null}
    </>
  )
}

interface CacheStatusProps {
  modelCache: ModelCacheInfo | null
}

/**
 * 진행률 문구는 캐시에서 읽을 때도 "내려받는 중"이라 구분이 안 된다 (계획 §7).
 * 실행 전에 무엇을 받아야 하는지 여기서 알려 준다.
 */
function CacheStatus({ modelCache }: CacheStatusProps) {
  if (!modelCache) return <Status tone="neutral" label="확인하는 중" />
  if (!modelCache.isReadable)
    return <Status tone="neutral" label="확인 불가" detail="시크릿 창이거나 캐시가 막혀 있다" />

  const { cachedCount, totalCount, missingLabels } = modelCache
  if (cachedCount === totalCount)
    return (
      <Status
        tone="success"
        label={`받아 둠 ${cachedCount}/${totalCount}`}
        detail="네트워크 없이 시작한다"
      />
    )

  return (
    <Status
      tone="neutral"
      label={`${cachedCount}/${totalCount}`}
      detail={`${missingLabels.join(', ')}을(를) 받아야 한다`}
    />
  )
}

export default function EnvironmentPanel({ environment, modelCache }: EnvironmentPanelProps) {
  if (!environment)
    return (
      <section className="panel">
        <h2>환경</h2>
        <p className="hint">환경을 확인하는 중…</p>
      </section>
    )

  const { webGpu } = environment

  return (
    <section className="panel">
      <h2>환경</h2>
      <dl className="facts">
        <dt>WebGPU 어댑터</dt>
        <dd>
          {webGpu.isAvailable ? (
            <Status
              tone="success"
              label="사용 가능"
              detail={`${webGpu.vendor ?? '알 수 없음'} / ${webGpu.architecture ?? '알 수 없음'}`}
            />
          ) : (
            <Status tone="danger" label="없음" detail={webGpu.reason ?? '이유 불명'} />
          )}
        </dd>

        <dt>shader-f16</dt>
        <dd>
          {webGpu.hasShaderF16 ? (
            <Status tone="success" label="지원" />
          ) : (
            <Status tone="neutral" label="미지원" detail="q4f16 대신 q4를 써야 한다" />
          )}
        </dd>

        <dt>최대 GPU 버퍼</dt>
        <dd>{webGpu.maxBufferMb ? `${webGpu.maxBufferMb}MB` : '—'}</dd>

        <dt>crossOriginIsolated</dt>
        <dd>
          {environment.isCrossOriginIsolated ? (
            <Status tone="success" label="예" />
          ) : (
            <Status tone="neutral" label="아니오" detail="WASM은 1스레드로 돈다" />
          )}
        </dd>

        <dt>논리 코어</dt>
        <dd>{environment.hardwareConcurrency}</dd>

        <dt>deviceMemory</dt>
        <dd>{environment.deviceMemoryGb ? `${environment.deviceMemoryGb}GB` : '—'}</dd>

        <dt>저장소 여유</dt>
        <dd>
          {environment.storageQuotaBytes
            ? `${formatGb(environment.storageUsageBytes ?? 0)} / ${formatGb(environment.storageQuotaBytes)}`
            : '—'}
        </dd>

        <dt>모델 캐시</dt>
        <dd>
          <CacheStatus modelCache={modelCache} />
        </dd>

        <dt>메모리 측정</dt>
        <dd>
          {environment.isMemoryMeasurable ? (
            <Status tone="success" label="가능" detail="실행이 끝나면 결과표에 피크가 찍힌다" />
          ) : (
            <Status
              tone="neutral"
              label="불가"
              detail="VITE_COEP=1로 띄워야 잰다 (crossOriginIsolated 필요)"
            />
          )}
        </dd>

        <dt>영구 저장</dt>
        <dd>
          {environment.isStoragePersisted ? (
            <Status tone="success" label="예" />
          ) : (
            <Status
              tone="neutral"
              label="아니오"
              detail="디스크가 빠듯하면 모델 캐시가 지워질 수 있다"
            />
          )}
        </dd>
      </dl>
    </section>
  )
}
