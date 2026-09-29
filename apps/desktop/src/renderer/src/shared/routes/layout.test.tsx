// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { AppShellLayout } from './layout'

vi.mock('@renderer/shared/api/events', () => ({
  onRecordingState: () => () => {},
  onUpdateAvailable: () => () => {}
}))
vi.mock('@renderer/shared/api/update', () => ({
  downloadUpdateApi: vi.fn(),
  installUpdateApi: vi.fn()
}))
vi.mock('@renderer/shared/api/prototype', () => ({
  getAuthStateApi: async () => ({
    isAuthenticated: true,
    user: { id: 'u', displayName: 'Tester' }
  }),
  logoutApi: vi.fn(),
  loginApi: vi.fn(),
  onPrototypeChanged: () => () => {}
}))

afterEach(cleanup)

describe('AppShellLayout navigation', () => {
  it.each([
    ['/documents/doc-1', '문서'],
    ['/meetings/meeting-1', '녹음 이력'],
    ['/record', '녹음'],
    ['/summaries/recording-1', '정리'],
    ['/settings', '설정']
  ])('keeps the parent menu active at %s', async (path, label) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <AppShellLayout />
      </MemoryRouter>
    )
    expect(screen.getByRole('link', { name: label }).getAttribute('aria-current')).toBe('page')
    expect(await screen.findByText('Tester')).toBeTruthy()
  })
})
