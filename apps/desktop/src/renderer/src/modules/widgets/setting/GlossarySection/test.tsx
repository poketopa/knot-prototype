// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@renderer/shared/api/glossary', () => ({
  getGlossaryApi: vi.fn(),
  updateGlossaryApi: vi.fn(),
  draftGlossaryApi: vi.fn()
}))

import { draftGlossaryApi, getGlossaryApi, updateGlossaryApi } from '@renderer/shared/api/glossary'
import GlossarySection from './index'

const TEAM_LABEL = /팀 소개/
const TERMS_LIST = { name: '용어 목록' }
const DRAFT_BUTTON = { name: '용어 초안 만들기' }
const SAVE_BUTTON = { name: '저장' }

const SAVED = { teamDescription: '프론트엔드 개발팀', terms: ['GitHub = 깃허브', '모노레포'] }

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const termList = async () => screen.findByRole('list', TERMS_LIST)

/** 행마다 `용어 = 읽기` 또는 `용어`로 읽어 화면 상태를 비교한다 */
const shownTerms = async () =>
  within(await termList())
    .getAllByRole('listitem')
    .map((item) => {
      const [term, readings] = within(item)
        .getAllByRole('textbox')
        .map((input) => (input as HTMLInputElement).value)
      return readings ? `${term} = ${readings}` : term
    })

const termInput = (position: number) =>
  screen.getByRole('textbox', { name: `용어 ${position}` }) as HTMLInputElement

const readingsInput = (position: number) =>
  screen.getByRole('textbox', { name: `용어 ${position} 한글 읽기` }) as HTMLInputElement

describe('GlossarySection', () => {
  it('저장된 팀 소개와 용어를 보여준다', async () => {
    vi.mocked(getGlossaryApi).mockResolvedValue(SAVED)
    render(<GlossarySection />)

    expect(await shownTerms()).toEqual(['GitHub = 깃허브', '모노레포'])
    expect((screen.getByLabelText(TEAM_LABEL) as HTMLTextAreaElement).value).toBe(
      '프론트엔드 개발팀'
    )
    expect((screen.getByRole('button', SAVE_BUTTON) as HTMLButtonElement).disabled).toBe(true)
  })

  it('초안의 새 용어만 목록 뒤에 덧붙이고 저장하지 않는다', async () => {
    vi.mocked(getGlossaryApi).mockResolvedValue(SAVED)
    vi.mocked(draftGlossaryApi).mockResolvedValue({
      terms: ['GitHub = 기티허브', 'React = 리액트', 'JWT = 제이더블유티']
    })
    render(<GlossarySection />)
    await termList()

    await userEvent.click(screen.getByRole('button', DRAFT_BUTTON))

    expect(await screen.findByText(/새 용어 2개를 덧붙였습니다/)).toBeTruthy()
    expect(await shownTerms()).toEqual([
      'GitHub = 깃허브',
      '모노레포',
      'React = 리액트',
      'JWT = 제이더블유티'
    ])
    expect(draftGlossaryApi).toHaveBeenCalledWith({ teamDescription: '프론트엔드 개발팀' })
    expect(updateGlossaryApi).not.toHaveBeenCalled()
    expect(screen.getByText('저장하지 않은 변경이 있습니다')).toBeTruthy()
  })

  it('행을 추가해 용어와 읽기를 칸별로 적고 저장한다', async () => {
    vi.mocked(getGlossaryApi).mockResolvedValue(SAVED)
    vi.mocked(updateGlossaryApi).mockResolvedValue({
      teamDescription: '프론트엔드 개발팀',
      terms: ['GitHub = 깃허브', '모노레포', 'tarball = 타볼, 타르볼']
    })
    render(<GlossarySection />)
    await termList()

    await userEvent.click(screen.getByRole('button', { name: '용어 추가' }))
    await userEvent.type(termInput(3), 'tarball')
    await userEvent.type(readingsInput(3), '타볼，타르볼')
    await userEvent.click(screen.getByRole('button', SAVE_BUTTON))

    expect(await screen.findByText('용어 3개를 저장했습니다')).toBeTruthy()
    expect(updateGlossaryApi).toHaveBeenCalledWith({
      teamDescription: '프론트엔드 개발팀',
      terms: ['GitHub = 깃허브', '모노레포', 'tarball = 타볼, 타르볼']
    })
    expect(await shownTerms()).toEqual(['GitHub = 깃허브', '모노레포', 'tarball = 타볼, 타르볼'])
  })

  it('읽기 칸에서 Enter를 누르면 아래에 새 행을 만들고 용어 칸으로 옮긴다', async () => {
    vi.mocked(getGlossaryApi).mockResolvedValue(SAVED)
    render(<GlossarySection />)
    await termList()

    await userEvent.type(readingsInput(1), '{Enter}')

    expect(await shownTerms()).toEqual(['GitHub = 깃허브', '', '모노레포'])
    expect(document.activeElement).toBe(termInput(2))
  })

  it('용어 칸에는 =를 입력받지 않고, 읽기가 빈 약어는 코드 읽기를 채워 저장한다', async () => {
    vi.mocked(getGlossaryApi).mockResolvedValue({ teamDescription: '', terms: [] })
    vi.mocked(updateGlossaryApi).mockResolvedValue({
      teamDescription: '',
      terms: ['JWT = 제이더블유티']
    })
    render(<GlossarySection />)
    await termList()

    await userEvent.type(termInput(1), 'JWT=')

    expect(termInput(1).value).toBe('JWT')
    expect(readingsInput(1).placeholder).toBe('제이더블유티')

    await userEvent.click(screen.getByRole('button', SAVE_BUTTON))

    expect(updateGlossaryApi).toHaveBeenCalledWith({
      teamDescription: '',
      terms: ['JWT = 제이더블유티']
    })
  })

  it('용어 칸에 목록을 붙여 넣으면 줄마다 행으로 나눈다', async () => {
    vi.mocked(getGlossaryApi).mockResolvedValue({ teamDescription: '', terms: [] })
    render(<GlossarySection />)
    await termList()

    await userEvent.click(termInput(1))
    await userEvent.paste('모노레포\nGitHub = 깃허브, 기트허브\n')

    expect(await shownTerms()).toEqual(['모노레포', 'GitHub = 깃허브, 기트허브'])
  })

  it('행을 지우면 저장하지 않은 변경으로 표시한다', async () => {
    vi.mocked(getGlossaryApi).mockResolvedValue(SAVED)
    render(<GlossarySection />)
    await termList()

    await userEvent.click(screen.getByRole('button', { name: '용어 1 삭제' }))

    expect(await shownTerms()).toEqual(['모노레포'])
    expect(screen.getByText('저장하지 않은 변경이 있습니다')).toBeTruthy()
  })

  it('팀 소개가 비어 있으면 초안을 만들 수 없다', async () => {
    vi.mocked(getGlossaryApi).mockResolvedValue({ teamDescription: '', terms: [] })
    render(<GlossarySection />)
    await termList()

    expect((screen.getByRole('button', DRAFT_BUTTON) as HTMLButtonElement).disabled).toBe(true)
  })

  it('초안이 실패하면 main의 안내 문구를 보여주고 목록은 그대로 둔다', async () => {
    vi.mocked(getGlossaryApi).mockResolvedValue(SAVED)
    vi.mocked(draftGlossaryApi).mockRejectedValue(
      new Error('용어 초안을 만들려면 요약 모델을 먼저 내려받아 주세요')
    )
    render(<GlossarySection />)
    await termList()

    await userEvent.click(screen.getByRole('button', DRAFT_BUTTON))

    expect((await screen.findByRole('alert')).textContent).toMatch(/요약 모델을 먼저 내려받아/)
    expect(await shownTerms()).toEqual(['GitHub = 깃허브', '모노레포'])
  })

  it('불러오기에 실패하면 안내한다', async () => {
    vi.mocked(getGlossaryApi).mockRejectedValue(new Error(''))
    render(<GlossarySection />)

    expect((await screen.findByRole('alert')).textContent).toBe('용어 사전을 불러오지 못했습니다')
  })
})
