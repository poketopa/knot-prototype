/**
 * WebGPU 어댑터 확인. `@webgpu/types`를 추가하지 않으려고 필요한 모양만 구조적으로 적었다.
 * 메인 스레드(S0 환경 패널)와 워커(장치 선택) 양쪽에서 쓴다.
 */

interface GpuAdapterLike {
  features: { has: (name: string) => boolean }
  info?: { vendor?: string; architecture?: string; device?: string; description?: string }
  limits?: Record<string, number>
}

interface GpuLike {
  requestAdapter: () => Promise<GpuAdapterLike | null>
}

export interface WebGpuInfo {
  isAvailable: boolean
  /** q4f16 가중치를 쓰려면 이 기능이 있어야 한다 */
  hasShaderF16: boolean
  vendor?: string
  architecture?: string
  maxBufferMb?: number
  reason?: string
}

const BYTES_PER_MB = 1024 * 1024

export const probeWebGpu = async (): Promise<WebGpuInfo> => {
  const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu
  if (!gpu) return { isAvailable: false, hasShaderF16: false, reason: 'navigator.gpu가 없다' }

  try {
    const adapter = await gpu.requestAdapter()
    if (!adapter) {
      return { isAvailable: false, hasShaderF16: false, reason: '어댑터를 받지 못했다' }
    }

    const maxBufferSize = adapter.limits?.maxBufferSize

    return {
      isAvailable: true,
      hasShaderF16: adapter.features.has('shader-f16'),
      vendor: adapter.info?.vendor,
      architecture: adapter.info?.architecture ?? adapter.info?.description,
      maxBufferMb: maxBufferSize ? Math.round(maxBufferSize / BYTES_PER_MB) : undefined
    }
  } catch (error) {
    return {
      isAvailable: false,
      hasShaderF16: false,
      reason: error instanceof Error ? error.message : String(error)
    }
  }
}
