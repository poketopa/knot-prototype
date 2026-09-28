import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isDeployableApiBaseUrl,
  isLoopbackApiBaseUrl,
  prototypeUserDataPath,
  resolvePrototypeApiBaseUrl
} from './config'

describe('isLoopbackApiBaseUrl', () => {
  it('로컬 loopback API만 허용한다', () => {
    expect(isLoopbackApiBaseUrl('http://127.0.0.1:4310/v1')).toBe(true)
    expect(isLoopbackApiBaseUrl('http://localhost:4310/v1')).toBe(true)
    expect(isLoopbackApiBaseUrl('https://api.example.com/v1')).toBe(false)
  })
})

it('다른 서버, URL 자격증명과 API 경로 변경을 거절한다', () => {
  for (const url of [
    'http://127.0.0.1.evil/v1',
    'http://user:password@localhost/v1',
    'http://localhost/v2',
    'http://localhost/v1?next=remote',
    'file:///v1'
  ]) {
    expect(isLoopbackApiBaseUrl(url)).toBe(false)
  }
  expect(isLoopbackApiBaseUrl('http://[::1]:4310/v1')).toBe(true)
})

describe('isDeployableApiBaseUrl', () => {
  it('공개 HTTPS /v1 API만 배포 endpoint로 허용한다', () => {
    expect(isDeployableApiBaseUrl('https://api.knot.example/v1')).toBe(true)
    expect(isDeployableApiBaseUrl('https://api.knot.example/v1/')).toBe(true)
  })

  it('자격증명, query, hash, 경로 변경, HTTP를 거절한다', () => {
    for (const url of [
      'http://api.knot.example/v1',
      'https://user:password@api.knot.example/v1',
      'https://api.knot.example/v2',
      'https://api.knot.example/v1?next=https://other.example/v1',
      'https://api.knot.example/v1#fragment'
    ]) {
      expect(isDeployableApiBaseUrl(url)).toBe(false)
    }
  })

  it('loopback과 private remote endpoint를 거절한다', () => {
    for (const url of [
      'https://localhost/v1',
      'https://127.0.0.1/v1',
      'https://8.8.8.8/v1',
      'https://10.0.0.10/v1',
      'https://172.16.0.10/v1',
      'https://192.168.1.10/v1',
      'https://169.254.1.10/v1',
      'https://[::1]/v1',
      'https://[::ffff:127.0.0.1]/v1',
      'https://prototype.local/v1'
    ]) {
      expect(isDeployableApiBaseUrl(url)).toBe(false)
    }
  })
})

describe('resolvePrototypeApiBaseUrl', () => {
  it('빌드 endpoint가 없으면 기존 runtime loopback 환경변수를 유지한다', () => {
    expect(
      resolvePrototypeApiBaseUrl({ runtimeEnv: { KNOT_API_BASE_URL: 'http://127.0.0.1:4311/v1' } })
    ).toBe('http://127.0.0.1:4311/v1')
  })

  it('빌드 endpoint가 있으면 runtime 환경변수로 다른 서버에 재지정할 수 없다', () => {
    expect(
      resolvePrototypeApiBaseUrl({
        runtimeEnv: { KNOT_API_BASE_URL: 'http://127.0.0.1:4311/v1' },
        buildApiBaseUrl: 'https://api.knot.example/v1'
      })
    ).toBe('https://api.knot.example/v1')
  })

  it('의미상 같은 배포 endpoint는 같은 canonical URL로 정규화한다', () => {
    expect(
      resolvePrototypeApiBaseUrl({ buildApiBaseUrl: 'https://API.KNOT.EXAMPLE:443/v1/' })
    ).toBe('https://api.knot.example/v1')
  })

  it('잘못된 빌드 endpoint는 앱 설정 단계에서 실패한다', () => {
    expect(() => resolvePrototypeApiBaseUrl({ buildApiBaseUrl: 'https://localhost/v1' })).toThrow(
      '공개 HTTPS'
    )
  })
})

describe('prototypeUserDataPath', () => {
  it('로컬 빌드는 기존 userData 프로필 경로를 그대로 유지한다', () => {
    expect(prototypeUserDataPath({ appDataPath: '/Users/me/Library/Application Support' })).toBe(
      path.join('/Users/me/Library/Application Support', 'KnotMeetingPrototype')
    )
  })

  it('의미상 같은 배포 endpoint는 같은 프로필 경로를 사용한다', () => {
    const appDataPath = '/Users/me/Library/Application Support'

    expect(
      prototypeUserDataPath({ appDataPath, buildApiBaseUrl: 'https://API.KNOT.EXAMPLE:443/v1/' })
    ).toBe(prototypeUserDataPath({ appDataPath, buildApiBaseUrl: 'https://api.knot.example/v1' }))
  })

  it('배포 빌드는 서버 endpoint별 안정 해시 프로필을 사용한다', () => {
    const first = prototypeUserDataPath({
      appDataPath: '/Users/me/Library/Application Support',
      buildApiBaseUrl: 'https://api.knot.example/v1'
    })
    const same = prototypeUserDataPath({
      appDataPath: '/Users/me/Library/Application Support',
      buildApiBaseUrl: 'https://api.knot.example/v1/'
    })
    const other = prototypeUserDataPath({
      appDataPath: '/Users/me/Library/Application Support',
      buildApiBaseUrl: 'https://api.other.example/v1'
    })

    expect(first).toBe(same)
    expect(first).toMatch(/KnotMeetingPrototype-[a-f0-9]{12}$/)
    expect(other).not.toBe(first)
  })
})
