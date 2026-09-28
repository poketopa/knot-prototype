import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  root: '',
  openExternal: vi.fn(),
  request: vi.fn(),
  isBusy: false,
  changed: vi.fn()
}))
vi.mock('electron', () => ({
  app: { getPath: () => mocks.root },
  shell: { openExternal: mocks.openExternal },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s).map((b) => b ^ 0x55),
    decryptString: (b: Buffer) =>
      Buffer.from(b)
        .map((c) => c ^ 0x55)
        .toString()
  }
}))
vi.mock('./events', () => ({ emitPrototypeChanged: mocks.changed }))
vi.mock('./apiClient', () => ({
  prototypeRequest: mocks.request,
  isPrototypeNetworkBusy: () => mocks.isBusy,
  PrototypeApiError: class extends Error {
    status = 401
  }
}))
import {
  beginPrototypeLogin,
  handlePrototypeAuthCallback,
  logoutPrototype,
  setPrototypeAuthLifecycle,
  flushPrototypeRevocations
} from './auth'
import {
  loadPrototypeAuthSession,
  savePrototypeAuthSession,
  savePrototypeAuthAttempt,
  prototypeAuthState,
  listSessionRevocations,
  getPrototypeAuthSession,
  prototypeUserRoot
} from './authState'
const userId = '11111111-1111-4111-8111-111111111111'
const attemptId = '22222222-2222-4222-8222-222222222222'
const session = {
  token: 'test-token-with-at-least-thirty-two-characters',
  user: { id: userId, displayName: '테스트' },
  expiresAt: new Date(Date.now() + 86_400_000).toISOString()
}
beforeEach(async () => {
  mocks.root = await mkdtemp(path.join(os.tmpdir(), 'knot-auth-test-'))
  mocks.request.mockReset()
  mocks.openExternal.mockReset()
  mocks.changed.mockReset()
  mocks.isBusy = false
  setPrototypeAuthLifecycle({ isBusy: () => false, beforeSwitch: () => {}, afterSwitch: () => {} })
  await loadPrototypeAuthSession()
})
afterEach(async () => {
  await flushPrototypeRevocations()
  await rm(mocks.root, { recursive: true, force: true })
})
describe('desktop OAuth session boundary', () => {
  it('PKCE attempt is recoverable from encrypted disk on cold callback; renderer only gets user state', async () => {
    mocks.request.mockResolvedValueOnce({
      attemptId,
      authorizeUrl: 'https://github.com/login/oauth/authorize?client_id=test'
    })
    await beginPrototypeLogin()
    const disk = await readFile(path.join(mocks.root, 'prototype', 'auth-attempt.bin'))
    expect(disk.toString()).not.toContain('verifier')
    expect(mocks.request.mock.calls[0][0].body).toEqual({ challenge: expect.any(String) })
    mocks.request.mockResolvedValueOnce({
      session: { token: session.token, expiresAt: session.expiresAt },
      user: session.user
    })
    expect(
      await handlePrototypeAuthCallback(
        `knot-prototype://auth/callback?attemptId=${attemptId}&ticket=ticket`
      )
    ).toBe(true)
    expect(prototypeAuthState()).toEqual({ isAuthenticated: true, user: session.user })
    expect(JSON.stringify(prototypeAuthState())).not.toContain(session.token)
    expect(prototypeUserRoot()).toBe(path.join(mocks.root, 'prototype', 'users', userId))
  })
  it('rejects mismatched and expired attempts before exchanging a ticket', async () => {
    await savePrototypeAuthAttempt({ id: attemptId, verifier: 'v', startedAt: Date.now() })
    await expect(
      handlePrototypeAuthCallback('knot-prototype://auth/callback?attemptId=wrong&ticket=t')
    ).rejects.toThrow('일치')
    await savePrototypeAuthAttempt({
      id: attemptId,
      verifier: 'v',
      startedAt: Date.now() - 660_000
    })
    await expect(
      handlePrototypeAuthCallback(`knot-prototype://auth/callback?attemptId=${attemptId}&ticket=t`)
    ).rejects.toThrow('만료')
    expect(mocks.request).not.toHaveBeenCalled()
  })
  it('blocks account switching while a pipeline or request owns the account', async () => {
    await savePrototypeAuthSession(session)
    mocks.isBusy = true
    await expect(logoutPrototype()).rejects.toThrow('동기화')
    expect(getPrototypeAuthSession()?.user.id).toBe(userId)
    mocks.isBusy = false
    setPrototypeAuthLifecycle({ isBusy: () => true, beforeSwitch: () => {}, afterSwitch: () => {} })
    await expect(beginPrototypeLogin()).rejects.toThrow('처리')
  })
  it('offline logout locks local data and retains owner-bound encrypted revocation for retry', async () => {
    await savePrototypeAuthSession(session)
    mocks.request.mockRejectedValue(new Error('offline'))
    await logoutPrototype()
    expect(prototypeAuthState().isAuthenticated).toBe(false)
    const revoked = await listSessionRevocations()
    expect(revoked).toHaveLength(1)
    expect(revoked[0].session.user.id).toBe(userId)
    expect(() => prototypeUserRoot()).toThrow('로그인')
  })
  it('rejects user ids that could escape account directory', async () => {
    await expect(
      savePrototypeAuthSession({ ...session, user: { id: '../../other', displayName: 'bad' } })
    ).rejects.toThrow('올바르지')
  })
})
