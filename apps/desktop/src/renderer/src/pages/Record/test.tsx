// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import Record from './index'

vi.mock('@renderer/modules/widgets/recording/RecorderSection', () => ({
  default: () => <section aria-label="녹음 시작">Recorder</section>
}))

describe('Record processing selection', () => {
  it('opens the recorder as the default Record tab', () => {
    render(
      <MemoryRouter initialEntries={['/record']}>
        <Record />
      </MemoryRouter>
    )

    expect(screen.getByRole('region', { name: '녹음 시작' })).toBeTruthy()
  })
})
