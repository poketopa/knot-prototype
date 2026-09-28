import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * `VITE_COEP=1`로 띄우면 COOP/COEP를 붙여 `crossOriginIsolated`를 켠다 — WASM 멀티스레드 확인용.
 * `credentialless`를 쓰는 이유는 `require-corp`면 CORP 헤더가 없는 Hugging Face 응답이 막히기 때문이다.
 * 기본값은 헤더 없음이다. 계획이 "헤더 없이 되는 구성"을 1순위로 잡았기 때문이다 (§3).
 */
const isolationHeaders =
  process.env.VITE_COEP === '1'
    ? {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless'
      }
    : undefined

export default defineConfig({
  plugins: [react()],
  // transformers.js를 프리번들하면 ORT WASM 자산 경로가 깨진다. 소스 그대로 로드시킨다.
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  worker: { format: 'es' },
  build: {
    target: 'esnext',
    /**
     * 4KB 미만이라 인라인될 AudioWorklet을 파일로 남긴다. `data:` URL이 되면
     * CSP가 붙은 환경에서 `audioWorklet.addModule`이 막히고, 개발 서버에서는 재현되지 않는다 (§7).
     */
    assetsInlineLimit: (filePath) => (filePath.endsWith('pcmRecorder.js') ? false : undefined)
  },
  /**
   * `strictPort`를 켜는 이유: 5180이 점유돼 있으면 Vite가 조용히 5181로 올라가는데,
   * Cache Storage는 origin 단위라 받아 둔 모델 570MB가 통째로 미스가 난다 (§7).
   * 포트가 밀릴 바에는 기동에 실패하는 쪽이 낫다.
   */
  server: { port: 5180, strictPort: true, headers: isolationHeaders }
})
