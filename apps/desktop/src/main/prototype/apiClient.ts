import { createReadStream } from 'node:fs'
import { getPrototypeAuthSession, pausePrototypeSync } from './authState'
import { prototypeApiBaseUrl } from './config'
import { emitPrototypeChanged } from './events'

interface RequestParams {
  method?: 'GET' | 'POST' | 'PUT'
  path: string
  body?: unknown
  token?: string
}
interface PrototypeApiErrorBody {
  code?: string
  message?: string
  retryable?: boolean
  requestId?: string
}
let inFlight = 0
export const isPrototypeNetworkBusy = () => inFlight > 0
export class PrototypeApiError extends Error {
  readonly code: string
  readonly status: number
  readonly retryable: boolean
  constructor({
    code,
    message,
    status,
    retryable
  }: {
    code: string
    message: string
    status: number
    retryable: boolean
  }) {
    super(message)
    this.code = code
    this.status = status
    this.retryable = retryable
  }
}
const messages: Record<string, string> = {
  AUTH_NOT_CONFIGURED:
    'GitHub 로그인이 아직 설정되지 않았습니다. .env.prototype.local의 OAuth 설정을 확인해 주세요.',
  SESSION_REQUIRED: 'GitHub 로그인 후 사용할 수 있습니다.',
  SESSION_INVALID: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
  ARTIFACT_CONTENT_TOO_LARGE:
    '녹음 파일이 서버의 업로드 한도를 초과했습니다. 로컬 원본은 보관됩니다.'
}
const verifyResponse = async (response: Response, isSessionRequest: boolean) => {
  if (response.status === 401 && isSessionRequest) {
    pausePrototypeSync('로그인이 만료되었습니다. 다시 로그인해 주세요.')
    emitPrototypeChanged({ reason: 'auth' })
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as PrototypeApiErrorBody
    throw new PrototypeApiError({
      code: body.code ?? `HTTP_${response.status}`,
      message: messages[body.code ?? ''] ?? body.message ?? '서버 요청에 실패했습니다',
      status: response.status,
      retryable: body.retryable ?? response.status >= 500
    })
  }
}
const apiUrl = (requestPath: string) => {
  if (!requestPath.startsWith('/') || requestPath.startsWith('//') || requestPath.includes('..'))
    throw new Error('서버 요청 경로가 올바르지 않습니다')
  const base = prototypeApiBaseUrl()
  return `${base}${requestPath.startsWith('/v1/') ? requestPath.slice(3) : requestPath}`
}
export const prototypeRequest = async <T>({
  method = 'GET',
  path,
  body,
  token
}: RequestParams): Promise<T> => {
  const session = getPrototypeAuthSession()
  const bearer = token ?? session?.token
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (bearer) headers.Authorization = `Bearer ${bearer}`
  inFlight++
  try {
    const response = await fetch(apiUrl(path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000)
    })
    await verifyResponse(response, token === undefined)
    const result = response.status === 204 ? undefined : await response.json()
    if (token === undefined && getPrototypeAuthSession()?.user.id !== session?.user.id)
      throw new Error('계정이 변경되어 요청 결과를 사용하지 않습니다')
    return result as T
  } finally {
    inFlight--
  }
}
export const prototypeUpload = async ({
  path,
  localPath,
  token
}: {
  path: string
  localPath: string
  token?: string
}) => {
  const bearer = token ?? getPrototypeAuthSession()?.token
  if (!bearer) throw new Error('로그인이 필요합니다')
  const input = createReadStream(localPath)
  inFlight++
  try {
    const init = {
      method: 'PUT',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/octet-stream' },
      body: input,
      duplex: 'half',
      redirect: 'error',
      signal: AbortSignal.timeout(30 * 60_000)
    } as unknown as RequestInit
    const response = await fetch(apiUrl(path), init)
    await verifyResponse(response, token === undefined)
    return (await response.json()) as unknown
  } finally {
    input.destroy()
    inFlight--
  }
}
