import { resolve } from 'path'
import {
  normalizeDeployableApiBaseUrl,
  BUILD_API_BASE_URL_ENV
} from './src/main/prototype/endpoint'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const SHARED_DIR = resolve('src/shared')
const WORKLET_FILE_NAME = 'pcmRecorder.js'
const buildApiBaseUrl = process.env[BUILD_API_BASE_URL_ENV]
  ? normalizeDeployableApiBaseUrl(process.env[BUILD_API_BASE_URL_ENV])
  : null

export default defineConfig({
  main: {
    define: {
      __KNOT_BUILD_API_BASE_URL__: JSON.stringify(buildApiBaseUrl)
    },
    resolve: {
      alias: {
        '@shared': SHARED_DIR
      }
    }
  },
  preload: {
    resolve: {
      alias: {
        '@shared': SHARED_DIR
      }
    }
  },
  renderer: {
    build: {
      // 워크릿이 data: URL로 인라인되면 CSP(script-src 'self')에 막힌다 (references/pitfalls.md)
      assetsInlineLimit: (filePath: string) =>
        filePath.endsWith(WORKLET_FILE_NAME) ? false : undefined
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': SHARED_DIR
      }
    },
    plugins: [react()]
  }
})
