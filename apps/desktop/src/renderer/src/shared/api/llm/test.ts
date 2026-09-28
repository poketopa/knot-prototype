import { afterEach, describe, expect, it, vi } from 'vitest'

import { checkLlmApi, getLlmStatusApi } from './index'

const stubApi = (llm: unknown) => vi.stubGlobal('window', { api: { llm } })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('llm api', () => {
  it('main이 던진 에러는 Electron 접두어를 떼고 원문만 남긴다', async () => {
    stubApi({
      check: () =>
        Promise.reject(
          new Error("Error invoking remote method 'llm:check': Error: API 키가 없습니다")
        )
    })

    await expect(checkLlmApi()).rejects.toThrow('API 키가 없습니다')
  })

  it('preload에 llm 브리지가 없으면 TypeError 대신 한국어 안내로 바꾼다', async () => {
    stubApi(undefined)

    await expect(getLlmStatusApi()).rejects.toThrow('LLM 설정을 불러오지 못했습니다')
  })

  it('성공 응답은 그대로 돌려준다', async () => {
    stubApi({ check: () => Promise.resolve({ message: '연결됐습니다' }) })

    await expect(checkLlmApi()).resolves.toEqual({ message: '연결됐습니다' })
  })
})
