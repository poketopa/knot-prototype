import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  session: {
    token: 'session-token',
    user: { id: '00000000-0000-4000-8000-000000000001', displayName: 'Tester' },
    expiresAt: '2026-10-01T00:00:00.000Z'
  },
  paused: vi.fn(),
  changed: vi.fn()
}))

vi.mock('./authState', () => ({
  getPrototypeAuthSession: () => state.session,
  pausePrototypeSync: state.paused
}))
vi.mock('./events', () => ({ emitPrototypeChanged: state.changed }))

let root: string
const originalFetch = globalThis.fetch

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'knot-api-client-'))
  state.paused.mockReset()
  state.changed.mockReset()
})

afterEach(async () => {
  globalThis.fetch = originalFetch
  await rm(root, { recursive: true, force: true })
})

it('uploads chunked descriptors with bounded chunk bodies and per-chunk checksums', async () => {
  const file = path.join(root, 'audio.wav')
  await writeFile(file, Buffer.from('aaaabbbbcc'))
  const calls: Array<{ url: string; init: RequestInit; body: Buffer }> = []
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init!, body: Buffer.from(init!.body as Buffer) })
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }) as typeof fetch
  const { prototypeUpload } = await import('./apiClient')

  await prototypeUpload({
    localPath: file,
    path: '/artifacts/artifact-a/content',
    descriptor: {
      mode: 'chunked',
      method: 'PUT',
      url: '/artifacts/artifact-a/content',
      chunkUrlTemplate: '/artifacts/artifact-a/chunks/{index}',
      chunkSize: 4,
      byteLength: 10,
      chunks: [
        {
          index: 1,
          sha256: '81cc5b17018674b401b42f35ba07bb79e211239c23bffe658da1577e3e646877',
          byteLength: 4
        }
      ]
    }
  })

  expect(calls.map((call) => call.url)).toEqual([
    'http://127.0.0.1:4310/v1/artifacts/artifact-a/chunks/0',
    'http://127.0.0.1:4310/v1/artifacts/artifact-a/chunks/2'
  ])
  expect(calls.map((call) => call.body.toString())).toEqual(['aaaa', 'cc'])
  expect(
    calls.map((call) => (call.init.headers as Record<string, string>)['Content-Length'])
  ).toEqual(['4', '2'])
})

it('skips file upload when the descriptor is already completed', async () => {
  const file = path.join(root, 'audio.wav')
  await writeFile(file, Buffer.from('audio'))
  globalThis.fetch = vi.fn() as typeof fetch
  const { prototypeUpload } = await import('./apiClient')

  await prototypeUpload({
    localPath: file,
    path: '/artifacts/artifact-a/content',
    descriptor: {
      mode: 'chunked',
      method: 'PUT',
      url: '/artifacts/artifact-a/content',
      completed: true
    }
  })

  expect(globalThis.fetch).not.toHaveBeenCalled()
})

it('pauses session sync when a chunk upload receives 401', async () => {
  const file = path.join(root, 'audio.wav')
  await writeFile(file, Buffer.from('aaaa'))
  globalThis.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ code: 'SESSION_INVALID', message: 'expired' }), {
        status: 401,
        headers: { 'content-type': 'application/json' }
      })
  ) as typeof fetch
  const { prototypeUpload } = await import('./apiClient')

  await expect(
    prototypeUpload({
      localPath: file,
      path: '/artifacts/artifact-a/content',
      descriptor: {
        mode: 'chunked',
        method: 'PUT',
        url: '/artifacts/artifact-a/content',
        chunkUrlTemplate: '/artifacts/artifact-a/chunks/{index}',
        chunkSize: 4,
        byteLength: 4,
        chunks: []
      }
    })
  ).rejects.toMatchObject({ code: 'SESSION_INVALID', status: 401 })
  expect(state.paused).toHaveBeenCalledWith('로그인이 만료되었습니다. 다시 로그인해 주세요.')
  expect(state.changed).toHaveBeenCalledWith({ reason: 'auth' })
})

it('maps non-json 413 responses to an HTTP code instead of surfacing HTML', async () => {
  globalThis.fetch = vi.fn(
    async () => new Response('<html>too large</html>', { status: 413 })
  ) as typeof fetch
  const { prototypeRequest, PrototypeApiError } = await import('./apiClient')

  await expect(prototypeRequest({ path: '/me' })).rejects.toMatchObject({
    code: 'HTTP_413',
    status: 413
  })
  await expect(prototypeRequest({ path: '/me' })).rejects.toBeInstanceOf(PrototypeApiError)
})
