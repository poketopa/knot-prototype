import { URLSearchParams } from 'node:url'

import type { FastifyRequest } from 'fastify'

import type { Db } from './db.js'
import { ApiError } from './errors.js'
import { randomToken, sha256Hex } from './crypto.js'
import type { AppConfig } from './config.js'

export type AuthenticatedUser = {
  id: string
  displayName: string
}

export type GithubUser = {
  id: string
  login: string
  name?: string | null
}

export type GithubProvider = {
  exchangeCode(code: string, verifier: string): Promise<string>
  getUser(accessToken: string): Promise<GithubUser>
}

export class RealGithubProvider implements GithubProvider {
  constructor(private readonly config: AppConfig) {}

  async exchangeCode(code: string, verifier: string): Promise<string> {
    if (!this.config.githubClientId || !this.config.githubClientSecret) {
      throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'GitHub OAuth is not configured')
    }
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: this.config.githubClientId,
        client_secret: this.config.githubClientSecret,
        code,
        redirect_uri: this.config.oauthCallbackUrl,
        code_verifier: verifier
      })
    })
    if (!response.ok) {
      throw new ApiError(503, 'GITHUB_TOKEN_EXCHANGE_FAILED', 'GitHub token exchange failed', true)
    }
    const body = (await response.json()) as { access_token?: string; error?: string }
    if (!body.access_token) {
      throw new ApiError(
        401,
        body.error ?? 'GITHUB_TOKEN_MISSING',
        'GitHub did not return an access token'
      )
    }
    return body.access_token
  }

  async getUser(accessToken: string): Promise<GithubUser> {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${accessToken}`,
        'user-agent': 'knot-prototype-api'
      }
    })
    if (!response.ok) {
      throw new ApiError(503, 'GITHUB_USER_FETCH_FAILED', 'GitHub user fetch failed', true)
    }
    const body = (await response.json()) as { id?: number; login?: string; name?: string | null }
    if (body.id === undefined || !body.login) {
      throw new ApiError(401, 'GITHUB_USER_INVALID', 'GitHub user response is invalid')
    }
    return {
      id: String(body.id),
      login: body.login,
      name: body.name
    }
  }
}

export async function authenticate(db: Db, request: FastifyRequest): Promise<AuthenticatedUser> {
  const authorization = request.headers.authorization
  if (!authorization?.startsWith('Bearer ')) {
    throw new ApiError(401, 'SESSION_REQUIRED', 'Login required')
  }
  const token = authorization.slice('Bearer '.length)
  const result = await db.query<{ id: string; display_name: string }>(
    `SELECT users.id, users.display_name
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = $1
       AND sessions.revoked_at IS NULL
       AND sessions.expires_at > now()`,
    [sha256Hex(token)]
  )
  if (result.rowCount !== 1) {
    throw new ApiError(401, 'SESSION_INVALID', 'Session is invalid or expired')
  }
  return { id: result.rows[0].id, displayName: result.rows[0].display_name }
}

export function buildGithubAuthorizeUrl(config: AppConfig, state: string, challenge: string) {
  if (!config.githubClientId || !config.githubClientSecret) {
    throw new ApiError(503, 'AUTH_NOT_CONFIGURED', 'GitHub OAuth is not configured')
  }
  const url = new URL('https://github.com/login/oauth/authorize')
  url.searchParams.set('client_id', config.githubClientId)
  url.searchParams.set('redirect_uri', config.oauthCallbackUrl)
  url.searchParams.set('scope', 'read:user')
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

export function buildDesktopCallback(config: AppConfig, attemptId: string, ticket: string) {
  const url = new URL(`${config.desktopScheme}://${config.desktopCallbackPath.replace(/^\//, '')}`)
  url.searchParams.set('attemptId', attemptId)
  url.searchParams.set('ticket', ticket)
  return url.toString()
}

export function newSessionToken() {
  return randomToken(32)
}
