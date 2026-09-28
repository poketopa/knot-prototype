/** S0 환경 확인. 프로토타입이 돌아갈 조건이 갖춰졌는지 한눈에 본다 */

import { isMemoryMeasurable } from './memory'
import { probeWebGpu, type WebGpuInfo } from './webgpu'

export interface EnvironmentInfo {
  /** true면 WASM 멀티스레드를 쓸 수 있다. COOP/COEP 헤더가 있어야 한다 */
  isCrossOriginIsolated: boolean
  /** true면 디스크가 빠듯해도 브라우저가 받아 둔 모델을 지우지 않는다 */
  isStoragePersisted: boolean
  /** true면 실행이 끝났을 때 결과표에 피크 메모리가 찍힌다 */
  isMemoryMeasurable: boolean
  hardwareConcurrency: number
  deviceMemoryGb?: number
  storageQuotaBytes?: number
  storageUsageBytes?: number
  webGpu: WebGpuInfo
  userAgent: string
}

/**
 * 저장소를 영구 모드로 올린다. 기본값인 best-effort로 두면 디스크가 빠듯할 때
 * 브라우저가 origin 단위로 캐시를 비워 받아 둔 모델 570MB가 사라진다 (계획 §7).
 * localhost는 대체로 그냥 승인된다.
 */
const ensurePersistentStorage = async () => {
  if (!navigator.storage?.persist) return false

  try {
    return (await navigator.storage.persisted()) || (await navigator.storage.persist())
  } catch (error) {
    // 승격에 실패해도 동작에는 지장이 없다. 다만 캐시가 날아갈 수 있다는 뜻이라 알려 둔다
    console.warn('저장소를 영구 모드로 올리지 못했습니다:', error)
    return false
  }
}

export const probeEnvironment = async (): Promise<EnvironmentInfo> => {
  // 승격을 먼저 해야 usage/quota가 승격 이후 값으로 찍힌다
  const isStoragePersisted = await ensurePersistentStorage()
  const estimate = navigator.storage?.estimate
    ? await navigator.storage.estimate().catch(() => null)
    : null

  return {
    isCrossOriginIsolated: globalThis.crossOriginIsolated,
    isStoragePersisted,
    isMemoryMeasurable: isMemoryMeasurable(),
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    storageQuotaBytes: estimate?.quota,
    storageUsageBytes: estimate?.usage,
    webGpu: await probeWebGpu(),
    userAgent: navigator.userAgent
  }
}
