import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// electron-vite 설정은 vitest가 읽지 않으므로 별칭을 여기서 다시 선언한다.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    // 기본 수집 패턴은 폴더 안 test.ts를 잡지 못한다 (.claude/rules/test-strategy.md)
    include: ['src/**/*.test.{ts,tsx}', 'src/**/test.{ts,tsx}'],
    environment: 'node'
  }
})
