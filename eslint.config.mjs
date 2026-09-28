import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  {
    ignores: [
      '**/node_modules',
      '**/dist',
      '**/out',
      'apps/desktop/scripts/fixtures',
      '.local/**',
      'apps/desktop/.prototype-smoke.cjs'
    ]
  },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules,
      // 프로젝트 컨벤션은 리턴 타입을 추론에 맡긴다 (.claude/rules/general-code-convention.md).
      // 계약이 되는 곳(apps/desktop/src/shared/ipc.ts 등)만 손으로 명시한다.
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  },
  {
    // 브라우저 워크릿과 Node 실행 스크립트는 순수 JS라 TS 반환 타입을 요구하지 않는다
    files: [
      'apps/desktop/src/renderer/src/worklet/*.js',
      'apps/web/src/audio/pcmRecorder.js',
      'scripts/*.mjs',
      'deploy/prototype/*.mjs'
    ],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  },
  eslintConfigPrettier
)
