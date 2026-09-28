import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let userDataDir: string
let ownerId = 'owner-a'
vi.mock('./authState', () => ({
  requirePrototypeUser: () => ({ id: ownerId }),
  prototypeUserRoot: () => path.join(userDataDir, ownerId)
}))
vi.mock('../models/service', () => ({ modelStatus: vi.fn() }))
vi.mock('../llm/check', () => ({ checkLlm: vi.fn() }))
import { modelStatus } from '../models/service'
import { checkLlm } from '../llm/check'
import { closeDb, getDb } from '../db/connection'
import { setLlmProvider } from '../db/settings'
import { completeSetup, getSetupStatus } from './setup'

const readyModels = { isReady: true, selectedWhisperModelId: 'turbo-q5' } as ReturnType<
  typeof modelStatus
>

describe('최초 모델 설정 완료', () => {
  beforeEach(async () => {
    userDataDir = await mkdtemp(path.join(os.tmpdir(), 'knot-setup-'))
    ownerId = 'owner-a'
    vi.mocked(modelStatus).mockReturnValue(readyModels)
    vi.mocked(checkLlm).mockResolvedValue({ message: '준비 완료' })
  })
  afterEach(async () => {
    closeDb()
    vi.resetAllMocks()
    await rm(userDataDir, { recursive: true, force: true })
  })
  it('처음에는 미완료이며 검증 성공 후 재실행해도 완료 상태를 보존한다', async () => {
    expect(getSetupStatus()).toEqual({ isComplete: false })
    expect(await completeSetup()).toEqual({ isComplete: true })
    expect(checkLlm).toHaveBeenCalledOnce()
    closeDb()
    expect(getSetupStatus()).toEqual({ isComplete: true })
  })
  it('STT 다운로드가 끝나지 않으면 AI 요청이나 완료 저장을 하지 않는다', async () => {
    vi.mocked(modelStatus).mockReturnValue({ ...readyModels, isReady: false })
    await expect(completeSetup()).rejects.toThrow('음성 인식 모델')
    expect(checkLlm).not.toHaveBeenCalled()
    expect(getSetupStatus().isComplete).toBe(false)
  })
  it.each(['local', 'codex-cli', 'claude-cli'] as const)(
    '%s 모델 또는 CLI 로그인 확인 실패 후 다시 시도할 수 있다',
    async (provider) => {
      setLlmProvider({ provider })
      vi.mocked(checkLlm).mockRejectedValueOnce(new Error('연결 실패'))
      await expect(completeSetup()).rejects.toThrow('연결 실패')
      expect(getSetupStatus().isComplete).toBe(false)
      await completeSetup()
      expect(getSetupStatus().isComplete).toBe(true)
    }
  )
  it('검증 도중 AI 선택이 바뀌면 새 선택을 완료 처리하지 않는다', async () => {
    vi.mocked(checkLlm).mockImplementationOnce(async () => {
      setLlmProvider({ provider: 'codex-cli' })
      return { message: '준비 완료' }
    })
    await expect(completeSetup()).rejects.toThrow('모델 설정이 변경')
    expect(getSetupStatus().isComplete).toBe(false)
  })
  it.each(['openai-api', 'claude-api'] as const)(
    '최초 설정에서 숨긴 %s 공급자를 호출하거나 완료 처리하지 않는다',
    async (provider) => {
      setLlmProvider({ provider })
      await expect(completeSetup()).rejects.toThrow('실행 방식을 선택')
      expect(checkLlm).not.toHaveBeenCalled()
      expect(getSetupStatus().isComplete).toBe(false)
    }
  )
  it('완료 상태는 다른 계정에 넘어가지 않는다', async () => {
    await completeSetup()
    closeDb()
    ownerId = 'owner-b'
    expect(getSetupStatus().isComplete).toBe(false)
  })
  it('검증 도중 계정이 변경되면 어느 계정에도 완료를 쓰지 않는다', async () => {
    vi.mocked(checkLlm).mockImplementationOnce(async () => {
      closeDb()
      ownerId = 'owner-b'
      return { message: '준비 완료' }
    })
    await expect(completeSetup()).rejects.toThrow('로그인 계정이 변경')
    expect(getSetupStatus().isComplete).toBe(false)
    closeDb()
    ownerId = 'owner-a'
    expect(getSetupStatus().isComplete).toBe(false)
  })
  it('잘못 저장된 완료 값은 설정 완료로 간주하지 않는다', () => {
    getDb().prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('setup.completed', '1')
    expect(getSetupStatus().isComplete).toBe(false)
  })
})
