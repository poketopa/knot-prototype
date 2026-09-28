import { createHash } from 'node:crypto'
import path from 'node:path'
import {
  API_BASE_URL_ENV,
  DEFAULT_API_BASE_URL,
  normalizeDeployableApiBaseUrl,
  normalizeLoopbackApiBaseUrl
} from './endpoint'

const LOCAL_USER_DATA_DIR_NAME = 'KnotMeetingPrototype'

declare const __KNOT_BUILD_API_BASE_URL__: string | null | undefined

interface ResolveApiBaseUrlParams {
  runtimeEnv?: NodeJS.ProcessEnv
  buildApiBaseUrl?: string | null
}

const injectedBuildApiBaseUrl = () => {
  if (typeof __KNOT_BUILD_API_BASE_URL__ === 'undefined') return null
  return __KNOT_BUILD_API_BASE_URL__
}

export const resolvePrototypeApiBaseUrl = ({
  runtimeEnv = process.env,
  buildApiBaseUrl = injectedBuildApiBaseUrl()
}: ResolveApiBaseUrlParams = {}) => {
  if (buildApiBaseUrl) return normalizeDeployableApiBaseUrl(buildApiBaseUrl)

  return normalizeLoopbackApiBaseUrl(runtimeEnv[API_BASE_URL_ENV] || DEFAULT_API_BASE_URL)
}

export const prototypeApiBaseUrl = () => resolvePrototypeApiBaseUrl()

export const prototypeUserDataPath = ({
  appDataPath,
  buildApiBaseUrl = injectedBuildApiBaseUrl()
}: {
  appDataPath: string
  buildApiBaseUrl?: string | null
}) => {
  if (!buildApiBaseUrl) return path.join(appDataPath, LOCAL_USER_DATA_DIR_NAME)

  const apiBaseUrl = normalizeDeployableApiBaseUrl(buildApiBaseUrl)
  const profileHash = createHash('sha256').update(apiBaseUrl).digest('hex').slice(0, 12)
  return path.join(appDataPath, `${LOCAL_USER_DATA_DIR_NAME}-${profileHash}`)
}

export { isDeployableApiBaseUrl, isLoopbackApiBaseUrl } from './endpoint'
