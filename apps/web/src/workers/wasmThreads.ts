import { env } from '@huggingface/transformers'

const MAX_WASM_THREADS = 8

/**
 * WASM 백엔드 스레드 수를 코어 수에 맞춘다.
 * `SharedArrayBuffer`가 있어야 멀티스레드가 되고, 그건 COOP/COEP로 격리된 문서에서만 생긴다.
 * 격리돼 있지 않으면 라이브러리 기본값(1스레드)을 그대로 둔다.
 */
export const applyWasmThreads = () => {
  if (!globalThis.crossOriginIsolated) return

  const wasm = env.backends.onnx.wasm
  if (!wasm) return

  wasm.numThreads = Math.min(navigator.hardwareConcurrency || 1, MAX_WASM_THREADS)
}
