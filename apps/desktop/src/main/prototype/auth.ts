import { createHash } from 'node:crypto'
import { shell } from 'electron'
import type { LoginPrototypeResponse, LogoutPrototypeResponse } from '@shared/ipc'
import {
  clearPrototypeAuthSession,
  clearPrototypeAuthAttempt,
  loadPrototypeAuthAttempt,
  prototypeAuthState,
  randomToken,
  safeEquals,
  savePrototypeAuthAttempt,
  savePrototypeAuthSession,
  getPrototypeAuthSession,
  setPrototypeAuthTransition,
  isPrototypeAuthTransitioning,
  queueSessionRevocation,
  listSessionRevocations,
  clearSessionRevocation,
  setPrototypeAuthError
} from './authState'
import { isPrototypeNetworkBusy, PrototypeApiError, prototypeRequest } from './apiClient'
import { emitPrototypeChanged } from './events'

interface AuthAttemptResponse {
  attemptId: string
  authorizeUrl: string
}
interface AuthExchangeResponse {
  session: { token: string; expiresAt: string }
  user: { id: string; displayName: string }
}
interface AuthLifecycle {
  isBusy: () => boolean
  beforeSwitch: () => Promise<void> | void
  afterSwitch: () => Promise<void> | void
}
let lifecycle: AuthLifecycle = {
  isBusy: () => false,
  beforeSwitch: () => {},
  afterSwitch: () => {}
}
let isStartingLogin = false
let isRevoking = false
export const setPrototypeAuthLifecycle = (hooks: AuthLifecycle) => {
  lifecycle = hooks
}
const assertSwitchAllowed = () => {
  if (isPrototypeAuthTransitioning() || lifecycle.isBusy() || isPrototypeNetworkBusy())
    throw new Error('녹음·처리·동기화가 끝난 뒤 로그인 상태를 변경해 주세요.')
}
export const beginPrototypeLogin = async (): Promise<LoginPrototypeResponse> => {
  assertSwitchAllowed()
  if (isStartingLogin) throw new Error('로그인 요청을 준비하고 있습니다')
  isStartingLogin = true
  try {
    const verifier = randomToken(48)
    const attempt = await prototypeRequest<AuthAttemptResponse>({
      method: 'POST',
      path: '/auth/attempts',
      body: { challenge: createHash('sha256').update(verifier).digest('base64url') },
      token: ''
    })
    const authorize = new URL(attempt.authorizeUrl)
    if (
      authorize.origin !== 'https://github.com' ||
      authorize.pathname !== '/login/oauth/authorize' ||
      authorize.username ||
      authorize.password
    )
      throw new Error('GitHub 로그인 주소가 올바르지 않습니다')
    await savePrototypeAuthAttempt({ id: attempt.attemptId, verifier, startedAt: Date.now() })
    setPrototypeAuthError()
    await shell.openExternal(authorize.toString())
    return prototypeAuthState()
  } finally {
    isStartingLogin = false
  }
}
export const handlePrototypeAuthCallback = async (rawUrl: string) => {
  const url = new URL(rawUrl)
  if (
    url.protocol !== 'knot-prototype:' ||
    url.hostname !== 'auth' ||
    url.pathname !== '/callback' ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  )
    return false
  const attemptId = url.searchParams.get('attemptId')
  const ticket = url.searchParams.get('ticket')
  if (
    !attemptId ||
    !ticket ||
    url.searchParams.getAll('attemptId').length !== 1 ||
    url.searchParams.getAll('ticket').length !== 1
  )
    throw new Error('로그인 callback이 올바르지 않습니다')
  assertSwitchAllowed()
  setPrototypeAuthTransition(true)
  try {
    const attempt = await loadPrototypeAuthAttempt()
    if (!attempt) throw new Error('진행 중인 로그인이 없습니다. 앱에서 로그인을 시작해 주세요.')
    if (Date.now() - attempt.startedAt > 10 * 60_000 || attempt.startedAt > Date.now()) {
      await clearPrototypeAuthAttempt()
      throw new Error('로그인 시간이 만료되었습니다. 다시 시도해 주세요.')
    }
    if (!safeEquals({ a: attempt.id, b: attemptId }))
      throw new Error('로그인 요청이 일치하지 않습니다')
    const response = await prototypeRequest<AuthExchangeResponse>({
      method: 'POST',
      path: '/auth/exchange',
      body: { attemptId, ticket, verifier: attempt.verifier },
      token: ''
    })
    const previous = getPrototypeAuthSession()
    if (previous) await queueSessionRevocation(previous)
    await lifecycle.beforeSwitch()
    await savePrototypeAuthSession({
      token: response.session.token,
      user: response.user,
      expiresAt: response.session.expiresAt
    })
    await clearPrototypeAuthAttempt()
    setPrototypeAuthTransition(false)
    emitPrototypeChanged({ reason: 'auth' })
    await lifecycle.afterSwitch()
    void flushPrototypeRevocations()
    return true
  } catch (caught) {
    setPrototypeAuthError(caught instanceof Error ? caught.message : '로그인에 실패했습니다')
    emitPrototypeChanged({ reason: 'auth' })
    throw caught
  } finally {
    setPrototypeAuthTransition(false)
  }
}
export const logoutPrototype = async (): Promise<LogoutPrototypeResponse> => {
  assertSwitchAllowed()
  setPrototypeAuthTransition(true)
  try {
    const previous = getPrototypeAuthSession()
    if (previous) await queueSessionRevocation(previous)
    await lifecycle.beforeSwitch()
    await clearPrototypeAuthSession()
    await clearPrototypeAuthAttempt()
    setPrototypeAuthTransition(false)
    emitPrototypeChanged({ reason: 'auth' })
    void flushPrototypeRevocations()
    return prototypeAuthState()
  } finally {
    setPrototypeAuthTransition(false)
  }
}
export const flushPrototypeRevocations = async () => {
  if (isRevoking) return
  isRevoking = true
  try {
    for (const entry of await listSessionRevocations()) {
      try {
        if (Date.parse(entry.session.expiresAt) > Date.now())
          await prototypeRequest({
            method: 'POST',
            path: '/auth/logout',
            token: entry.session.token
          })
        await clearSessionRevocation(entry.id)
      } catch (caught) {
        if (caught instanceof PrototypeApiError && caught.status === 401)
          await clearSessionRevocation(entry.id)
        // 네트워크 실패는 암호화된 재전송 기록을 유지한다. 토큰을 로그에 남기지 않는다.
      }
    }
  } finally {
    isRevoking = false
  }
}
