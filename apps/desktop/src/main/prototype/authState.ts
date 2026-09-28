import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { app, safeStorage } from 'electron'
import type { PrototypeAuthState, PrototypeUser } from '@shared/prototype'

export interface StoredAuthSession {
  token: string
  user: PrototypeUser
  expiresAt: string
}
export interface StoredAuthAttempt {
  id: string
  verifier: string
  startedAt: number
}
let cachedSession: StoredAuthSession | null = null
let syncPauseMessage: string | undefined
let authError: string | undefined
let isTransitioning = false
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const authDir = () => path.join(app.getPath('userData'), 'prototype')
const authFile = () => path.join(authDir(), 'auth-session.bin')
const pendingAttemptFile = () => path.join(authDir(), 'auth-attempt.bin')
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')
export const safeEquals = ({ a, b }: { a: string; b: string }) => {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
const writeSafeJson = async (file: string, value: unknown) => {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('이 Mac에서 안전한 로그인 저장소를 사용할 수 없습니다')
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(safeStorage.encryptString(JSON.stringify(value)))
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, file)
}
const readSafeJson = async <T>(file: string): Promise<T | null> => {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null
    return JSON.parse(safeStorage.decryptString(await readFile(file))) as T
  } catch {
    return null
  }
}
const isSession = (value: StoredAuthSession | null): value is StoredAuthSession =>
  Boolean(
    value &&
    typeof value.token === 'string' &&
    value.token.length >= 32 &&
    UUID.test(value.user?.id ?? '') &&
    typeof value.user?.displayName === 'string' &&
    Number.isFinite(Date.parse(value.expiresAt))
  )
export const loadPrototypeAuthSession = async () => {
  const stored = await readSafeJson<StoredAuthSession>(authFile())
  cachedSession = isSession(stored) ? stored : null
  syncPauseMessage =
    cachedSession && Date.parse(cachedSession.expiresAt) <= Date.now()
      ? '로그인이 만료되었습니다. 다시 로그인하면 서버 저장이 이어집니다.'
      : undefined
  return cachedSession
}
export const getPrototypeAuthSession = () => cachedSession
export const savePrototypeAuthSession = async (session: StoredAuthSession) => {
  if (!isSession(session)) throw new Error('로그인 응답이 올바르지 않습니다')
  await writeSafeJson(authFile(), session)
  cachedSession = session
  syncPauseMessage = undefined
  authError = undefined
}
export const savePrototypeAuthAttempt = (attempt: StoredAuthAttempt) =>
  writeSafeJson(pendingAttemptFile(), attempt)
export const loadPrototypeAuthAttempt = async () => {
  const attempt = await readSafeJson<StoredAuthAttempt>(pendingAttemptFile())
  return attempt &&
    UUID.test(attempt.id) &&
    typeof attempt.verifier === 'string' &&
    Number.isFinite(attempt.startedAt)
    ? attempt
    : null
}
export const clearPrototypeAuthAttempt = () => rm(pendingAttemptFile(), { force: true })
export const clearPrototypeAuthSession = async () => {
  await rm(authFile(), { force: true })
  cachedSession = null
  syncPauseMessage = undefined
  authError = undefined
}
export const pausePrototypeSync = (message: string) => {
  syncPauseMessage = message
}
export const setPrototypeAuthError = (message?: string) => {
  authError = message
}
export const setPrototypeAuthTransition = (value: boolean) => {
  isTransitioning = value
}
export const isPrototypeAuthTransitioning = () => isTransitioning
export const prototypeAuthState = (): PrototypeAuthState => ({
  isAuthenticated: cachedSession !== null,
  user: cachedSession?.user ?? null,
  ...(authError || syncPauseMessage ? { error: authError || syncPauseMessage } : {}),
  ...(syncPauseMessage ? { isSyncPaused: true } : {})
})
export const requirePrototypeUser = () => {
  if (isTransitioning)
    throw new Error('로그인 상태를 변경하고 있습니다. 잠시 후 다시 시도해 주세요.')
  if (!cachedSession) throw new Error('GitHub 로그인 후 사용할 수 있습니다')
  return cachedSession.user
}
export const prototypeUserRoot = () => path.join(authDir(), 'users', requirePrototypeUser().id)

// 로그아웃의 원격 폐기는 계정과 토큰을 함께 암호화해 남긴다. 자료용 DB와 수명을 분리한다.
export const queueSessionRevocation = async (session: StoredAuthSession) => {
  const id = randomUUID()
  await writeSafeJson(path.join(authDir(), 'revocations', `${id}.bin`), session)
  return id
}
export const listSessionRevocations = async () => {
  const dir = path.join(authDir(), 'revocations')
  const names = await readdir(dir).catch(() => [] as string[])
  const records: Array<{ id: string; session: StoredAuthSession }> = []
  for (const name of names) {
    const id = name.replace(/\.bin$/, '')
    if (!UUID.test(id)) continue
    const session = await readSafeJson<StoredAuthSession>(path.join(dir, name))
    if (isSession(session)) records.push({ id, session })
  }
  return records
}
export const clearSessionRevocation = async (id: string) => {
  if (!UUID.test(id)) throw new Error('폐기 요청 식별자가 올바르지 않습니다')
  await rm(path.join(authDir(), 'revocations', `${id}.bin`), { force: true })
}
