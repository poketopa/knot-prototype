import { isIP } from 'node:net'

export const DEFAULT_API_BASE_URL = 'http://127.0.0.1:4310/v1'
export const API_BASE_URL_ENV = 'KNOT_API_BASE_URL'
export const BUILD_API_BASE_URL_ENV = 'KNOT_BUILD_API_BASE_URL'

const hostnameOf = (url: URL) => url.hostname.replace(/^\[(.*)]$/, '$1').toLowerCase()

const isLoopbackHostname = (hostname: string) => {
  if (hostname === 'localhost' || hostname === '::1') return true
  return isIP(hostname) === 4 && hostname.startsWith('127.')
}

const hasCommonSafeShape = (url: URL) =>
  !url.username &&
  !url.password &&
  !url.search &&
  !url.hash &&
  url.pathname.replace(/\/+$/, '') === '/v1'

export const isLoopbackApiBaseUrl = (value: string) => {
  try {
    const url = new URL(value)
    const hostname = hostnameOf(url)

    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      isLoopbackHostname(hostname) &&
      hasCommonSafeShape(url)
    )
  } catch {
    return false
  }
}

export const normalizeLoopbackApiBaseUrl = (value: string) => {
  if (!isLoopbackApiBaseUrl(value)) {
    throw new Error('프로토타입 로컬 앱은 loopback API 주소만 사용할 수 있습니다')
  }
  const url = new URL(value)
  url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString().replace(/\/+$/, '')
}

export const isDeployableApiBaseUrl = (value: string) => {
  try {
    const url = new URL(value)
    const hostname = hostnameOf(url)
    const ipVersion = isIP(hostname)

    if (url.protocol !== 'https:' || !hasCommonSafeShape(url)) return false
    if (!hostname || ipVersion !== 0 || isLoopbackHostname(hostname)) return false
    if (hostname.endsWith('.localhost') || hostname.endsWith('.local')) return false

    return true
  } catch {
    return false
  }
}

export const normalizeDeployableApiBaseUrl = (value: string) => {
  if (!isDeployableApiBaseUrl(value)) {
    throw new Error(`${BUILD_API_BASE_URL_ENV}는 공개 HTTPS /v1 API 주소여야 합니다`)
  }
  const url = new URL(value)
  url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString().replace(/\/+$/, '')
}
