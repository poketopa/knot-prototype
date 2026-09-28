// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LlmStatus } from '@shared/types'

vi.mock('@renderer/shared/api/llm', () => ({
  getLlmStatusApi: vi.fn(),
  setLlmProviderApi: vi.fn(),
  setLlmApiKeyApi: vi.fn(),
  setOpenaiModelApi: vi.fn(),
  checkLlmApi: vi.fn()
}))

import {
  checkLlmApi,
  getLlmStatusApi,
  setLlmApiKeyApi,
  setLlmProviderApi,
  setOpenaiModelApi
} from '@renderer/shared/api/llm'
import LlmSection from './index'

const statusOf = (overrides: Partial<LlmStatus> = {}): LlmStatus => ({
  provider: 'local',
  isLocalModelReady: true,
  apiKeys: {
    anthropic: { isSaved: false, tail: null },
    openai: { isSaved: false, tail: null }
  },
  openaiModel: 'gpt-6-sol',
  claudeCliPath: null,
  claudeCliVersion: null,
  ...overrides
})

const savedKeys = (overrides: Partial<LlmStatus['apiKeys']> = {}): LlmStatus['apiKeys'] => ({
  anthropic: { isSaved: false, tail: null },
  openai: { isSaved: false, tail: null },
  ...overrides
})

const renderSection = async (status: LlmStatus) => {
  vi.mocked(getLlmStatusApi).mockResolvedValue(status)

  await act(async () => {
    render(<LlmSection localModelSlot={<p>로컬 모델 파일 행</p>} />)
  })
}

const findRadio = (name: RegExp) => screen.getByRole('radio', { name })

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('LlmSection', () => {
  it('기본은 로컬 모델이고 회의록 전송 여부를 공급자마다 설명한다', async () => {
    await renderSection(statusOf())

    expect(findRadio(/로컬 모델/).hasAttribute('checked')).toBe(true)
    expect(screen.getByText(/원본과 정리 결과는 보관용 서버에 저장합니다/)).toBeTruthy()
    expect(screen.getAllByText(/Anthropic 서버로 전송/)).toHaveLength(2)
    expect(screen.getAllByText(/OpenAI 서버로 전송/)).toHaveLength(2)
    expect(screen.queryByRole('button', { name: '연결 확인' })).toBeNull()
  })

  it('로컬을 골랐을 때만 모델 파일 다운로드 행을 끼운다', async () => {
    await renderSection(statusOf())
    expect(screen.getByText('로컬 모델 파일 행')).toBeTruthy()

    cleanup()
    await renderSection(statusOf({ provider: 'claude-api' }))
    expect(screen.queryByText('로컬 모델 파일 행')).toBeNull()
  })

  it('Claude API를 고르면 저장하고 Anthropic 키 입력란을 보여 준다', async () => {
    const user = userEvent.setup()
    vi.mocked(setLlmProviderApi).mockResolvedValue(statusOf({ provider: 'claude-api' }))
    await renderSection(statusOf())

    await user.click(findRadio(/Claude API/))

    expect(setLlmProviderApi).toHaveBeenCalledWith({ provider: 'claude-api' })
    expect(screen.getByLabelText('Claude API 키')).toBeTruthy()
    expect(screen.getByText(/console\.anthropic\.com/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '연결 확인' })).toBeTruthy()
    expect(screen.queryByLabelText('GPT 모델')).toBeNull()
  })

  it('OpenAI API를 고르면 OpenAI 키 입력란과 GPT 모델 선택을 보여 준다', async () => {
    const user = userEvent.setup()
    vi.mocked(setLlmProviderApi).mockResolvedValue(statusOf({ provider: 'openai-api' }))
    await renderSection(statusOf())

    await user.click(findRadio(/OpenAI API/))

    expect(setLlmProviderApi).toHaveBeenCalledWith({ provider: 'openai-api' })
    expect(screen.getByLabelText('OpenAI API 키')).toBeTruthy()
    expect(screen.getByText(/platform\.openai\.com/)).toBeTruthy()
    expect((screen.getByLabelText('GPT 모델') as HTMLSelectElement).value).toBe('gpt-6-sol')
    expect(screen.getByRole('button', { name: '연결 확인' })).toBeTruthy()
  })

  it('키를 저장하면 회사를 함께 보내고 입력란을 비운 뒤 마지막 네 자만 보여 준다', async () => {
    const user = userEvent.setup()
    vi.mocked(setLlmApiKeyApi).mockResolvedValue(
      statusOf({
        provider: 'openai-api',
        apiKeys: savedKeys({ openai: { isSaved: true, tail: 'wxyz' } })
      })
    )
    await renderSection(statusOf({ provider: 'openai-api' }))

    const input = screen.getByLabelText('OpenAI API 키') as HTMLInputElement
    await user.type(input, 'sk-proj-wxyz')
    await user.click(screen.getByRole('button', { name: '저장' }))

    expect(setLlmApiKeyApi).toHaveBeenCalledWith({ vendor: 'openai', apiKey: 'sk-proj-wxyz' })
    expect(input.value).toBe('')
    expect(input.getAttribute('type')).toBe('password')
    expect(screen.getByText(/…wxyz/)).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('API 키를 저장했습니다')
  })

  it('저장된 키가 있으면 그 회사의 키를 지울 수 있다', async () => {
    const user = userEvent.setup()
    vi.mocked(setLlmApiKeyApi).mockResolvedValue(statusOf({ provider: 'claude-api' }))
    await renderSection(
      statusOf({
        provider: 'claude-api',
        apiKeys: savedKeys({ anthropic: { isSaved: true, tail: 'wxyz' } })
      })
    )

    await user.click(screen.getByRole('button', { name: '키 삭제' }))

    expect(setLlmApiKeyApi).toHaveBeenCalledWith({ vendor: 'anthropic', apiKey: null })
    expect(screen.queryByRole('button', { name: '키 삭제' })).toBeNull()
  })

  it('회사별 키는 따로 저장되어 공급자를 오가도 남아 있다', async () => {
    await renderSection(
      statusOf({
        provider: 'claude-api',
        apiKeys: savedKeys({
          anthropic: { isSaved: true, tail: 'aaaa' },
          openai: { isSaved: true, tail: 'bbbb' }
        })
      })
    )

    expect(screen.getByText(/…aaaa/)).toBeTruthy()
    expect(screen.queryByText(/…bbbb/)).toBeNull()
  })

  it('GPT 모델을 바꾸면 저장한다', async () => {
    const user = userEvent.setup()
    vi.mocked(setOpenaiModelApi).mockResolvedValue(
      statusOf({ provider: 'openai-api', openaiModel: 'gpt-6-luna' })
    )
    await renderSection(statusOf({ provider: 'openai-api' }))

    await user.selectOptions(screen.getByLabelText('GPT 모델'), 'gpt-6-luna')

    expect(setOpenaiModelApi).toHaveBeenCalledWith({ model: 'gpt-6-luna' })
    expect((screen.getByLabelText('GPT 모델') as HTMLSelectElement).value).toBe('gpt-6-luna')
    expect(screen.getByText(/가장 저렴하고 빠른 모델/)).toBeTruthy()
  })

  it('Claude Code를 골랐는데 명령을 못 찾으면 설치 안내를 보여 준다', async () => {
    await renderSection(statusOf({ provider: 'claude-cli' }))

    expect(screen.getByRole('alert').textContent).toContain('claude 명령을 찾을 수 없습니다')
  })

  it('Claude Code 명령을 찾았으면 경로와 버전을 보여 준다', async () => {
    await renderSection(
      statusOf({
        provider: 'claude-cli',
        claudeCliPath: '/Users/me/.local/bin/claude',
        claudeCliVersion: '2.1.281 (Claude Code)'
      })
    )

    expect(screen.getByText('/Users/me/.local/bin/claude')).toBeTruthy()
    expect(screen.getByText(/2\.1\.281/)).toBeTruthy()
  })

  it('연결 확인 결과를 보여 주고 실패하면 안내한다', async () => {
    const user = userEvent.setup()
    vi.mocked(checkLlmApi).mockResolvedValueOnce({
      message: 'Claude Code에 연결했습니다 (응답: 확인)'
    })
    vi.mocked(checkLlmApi).mockRejectedValueOnce(new Error('Not logged in · Please run /login'))
    await renderSection(
      statusOf({ provider: 'claude-cli', claudeCliPath: '/usr/local/bin/claude' })
    )

    await user.click(screen.getByRole('button', { name: '연결 확인' }))
    expect(screen.getByRole('status').textContent).toContain('Claude Code에 연결했습니다')

    await user.click(screen.getByRole('button', { name: '연결 확인' }))
    expect(screen.getByRole('alert').textContent).toContain('Not logged in')
  })

  it('공급자 저장에 실패하면 안내를 보여 준다', async () => {
    const user = userEvent.setup()
    vi.mocked(setLlmProviderApi).mockRejectedValue(new Error('알 수 없는 LLM 공급자입니다'))
    await renderSection(statusOf())

    await user.click(findRadio(/Claude Code/))

    expect(screen.getByRole('alert').textContent).toContain('알 수 없는 LLM 공급자입니다')
    expect(findRadio(/로컬 모델/).hasAttribute('checked')).toBe(true)
  })

  it('허용 목록 밖 공급자가 저장되어 있으면 API 입력란을 숨기고 선택을 요구한다', async () => {
    vi.mocked(getLlmStatusApi).mockResolvedValue(statusOf({ provider: 'openai-api' }))

    await act(async () => {
      render(
        <LlmSection
          allowedProviders={['local', 'codex-cli', 'claude-cli']}
          localModelSlot={<p>로컬 모델 파일 행</p>}
        />
      )
    })

    expect(screen.getByRole('alert').textContent).toContain('실행 방식을 선택해 주세요')
    expect(screen.queryByLabelText('OpenAI API 키')).toBeNull()
    expect(screen.queryByLabelText('GPT 모델')).toBeNull()
  })
})
