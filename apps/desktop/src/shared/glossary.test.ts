import { describe, expect, it } from 'vitest'

import {
  acronymReading,
  buildGlossaryDraftPrompt,
  codeReadingLineOf,
  GLOSSARY_MAX_TERMS,
  GLOSSARY_TEAM_MAX_CHARS,
  GLOSSARY_TERM_MAX_CHARS,
  mergeGlossaryTerms,
  normalizeGlossaryTerms,
  parseGlossaryDraft,
  prependTeamTerms,
  readGlossarySettings,
  readTeamDescription,
  teamTermsOf
} from './glossary'

// Qwen3-4B-Instruct-2507 Q4_K_M 실제 초안 출력에서 옮긴 줄 (docs/phase5-refine-results.md)
const DRAFT_OUTPUT = [
  'React = 리액트  ',
  'Yarn = 와이어너  ',
  'CI/CD = 시이아이케이디  ',
  'JWT = 제이에이티비  ',
  'GitHub = 깃허브  ',
  'ROAS = 루오아스  ',
  'ROAS = 루오아스  ',
  '임상시험',
  ''
].join('\n')

describe('acronymReading', () => {
  it('대문자 약어를 알파벳 이름으로 읽는다', () => {
    expect(acronymReading('JWT')).toBe('제이더블유티')
    expect(acronymReading('API')).toBe('에이피아이')
  })

  it('/로 이은 약어는 조각마다 읽고 띄어 쓴다', () => {
    expect(acronymReading('CI/CD')).toBe('씨아이 씨디')
  })

  it('약어 안의 숫자는 영어로 읽는다', () => {
    expect(acronymReading('S3')).toBe('에스쓰리')
    expect(acronymReading('GA4')).toBe('지에이포')
  })

  it('약어가 아니면 undefined', () => {
    expect(acronymReading('React')).toBeUndefined()
    expect(acronymReading('npm')).toBeUndefined()
    expect(acronymReading('A')).toBeUndefined()
    expect(acronymReading('2024')).toBeUndefined()
    expect(acronymReading('임상시험')).toBeUndefined()
  })
})

describe('codeReadingLineOf', () => {
  it('사전에 있으면 정식 표기와 사전 읽기로 줄을 만든다', () => {
    expect(codeReadingLineOf('github')).toBe('GitHub = 깃허브')
  })

  it('사전에 없는 약어는 약어 읽기로 줄을 만든다', () => {
    expect(codeReadingLineOf('JWT')).toBe('JWT = 제이더블유티')
  })

  it('약어 모양이어도 사전이 이긴다', () => {
    expect(codeReadingLineOf('SQL')).toBe('SQL = 에스큐엘, 시퀄')
  })

  it('사전에도 없고 약어도 아니면 undefined', () => {
    expect(codeReadingLineOf('whisper.cpp')).toBeUndefined()
  })
})

describe('parseGlossaryDraft', () => {
  const terms = parseGlossaryDraft(DRAFT_OUTPUT)

  it('줄 끝 공백과 빈 줄을 정리한다', () => {
    expect(terms).toContain('React = 리액트')
    expect(terms).toContain('임상시험')
    expect(terms).not.toContain('')
  })

  it('약어는 모델 읽기를 버리고 코드 읽기로 바꾼다', () => {
    expect(terms).toContain('JWT = 제이더블유티')
    expect(terms).toContain('CI/CD = 씨아이 씨디')
    expect(terms).toContain('ROAS = 알오에이에스')
  })

  it('사전에 있는 용어는 모델 읽기를 버리고 사전 읽기로 바꾼다', () => {
    expect(terms).toContain('Yarn = 얀')
    expect(
      parseGlossaryDraft(
        'Jira = 재자\nGit = 기트\nRedux = 레덕스\nTailwind = 타일윈드\nESLint = 엔엘식\n'
      )
    ).toEqual([
      'Jira = 지라',
      'Git = 깃',
      'Redux = 리덕스',
      'Tailwind = 테일윈드',
      'ESLint = 이에스린트'
    ])
  })

  it('사전 표기와 대소문자가 달라도 찾고 표기를 사전 표기로 맞춘다', () => {
    expect(parseGlossaryDraft('Github = 깃헙\nSQL = 에스큐엘엘\n')).toEqual([
      'GitHub = 깃허브',
      'SQL = 에스큐엘, 시퀄'
    ])
  })

  it('사전에 없는 용어는 모델 읽기를 그대로 둔다', () => {
    expect(parseGlossaryDraft('whisper.cpp = 위스퍼 씨피피\n')).toEqual([
      'whisper.cpp = 위스퍼 씨피피'
    ])
  })

  it('.js 이름은 읽기 끝을 제이에스로 고친다', () => {
    expect(
      parseGlossaryDraft('Next.js = 넥스트 포인트\nVue.js = 뷰\nNode.js = 노드 제이에스\n')
    ).toEqual(['Next.js = 넥스트 제이에스', 'Vue.js = 뷰 제이에스', 'Node.js = 노드 제이에스'])
  })

  it('같은 용어는 한 번만 남긴다', () => {
    expect(terms.filter((term) => term.startsWith('ROAS'))).toHaveLength(1)
  })

  it('형식에 맞지 않는 줄은 버린다', () => {
    expect(parseGlossaryDraft('React = 리액트\nReact\n= 리액트\nVue =\n1. 모노레포\n')).toEqual([
      'React = 리액트'
    ])
  })
})

describe('teamTermsOf', () => {
  it('팀 소개의 영어 이름을 적힌 순서대로 찾는다', () => {
    expect(
      teamTermsOf('프론트엔드팀. Electron, React, whisper.cpp로 앱을 만들고 react와 S3를 씁니다.')
    ).toEqual(['Electron', 'React', 'whisper.cpp', 'S3'])
  })

  it('한 글자와 숫자만 있는 토큰은 뺀다', () => {
    expect(teamTermsOf('A팀, 2024년 목표')).toEqual([])
  })
})

describe('prependTeamTerms', () => {
  it('팀 소개 이름을 앞에 두고 모델 줄이 있으면 그 줄을 쓴다', () => {
    expect(
      prependTeamTerms({
        terms: ['Vite = 비트', 'React = 리액트'],
        teamDescription: 'whisper.cpp, React, sherpa-onnx 앱'
      })
    ).toEqual(['whisper.cpp', 'React = 리액트', 'sherpa-onnx', 'Vite = 비트'])
  })

  it('모델이 빠뜨린 약어는 코드 읽기로 넣는다', () => {
    expect(prependTeamTerms({ terms: [], teamDescription: 'STT 앱' })).toEqual(['STT = 에스티티'])
  })

  it('모델이 빠뜨린 사전 용어는 사전 읽기로 넣는다', () => {
    expect(prependTeamTerms({ terms: [], teamDescription: 'Electron, jira 앱' })).toEqual([
      'Electron = 일렉트론',
      'Jira = 지라'
    ])
  })
})

describe('normalizeGlossaryTerms', () => {
  it('공백을 자르고 빈 줄과 중복(= 앞부분, 대소문자 무시)을 뺀다', () => {
    expect(
      normalizeGlossaryTerms(['  GitHub = 깃허브 ', '', 'github = 기트허브', '모노레포', '   '])
    ).toEqual(['GitHub = 깃허브', '모노레포'])
  })
})

describe('mergeGlossaryTerms', () => {
  it('지금 목록을 유지하고 새 용어만 뒤에 덧붙인다', () => {
    const result = mergeGlossaryTerms({
      current: ['GitHub = 깃허브', '모노레포'],
      additions: ['GitHub = 기티허브', 'React = 리액트', '모노레포']
    })

    expect(result.terms).toEqual(['GitHub = 깃허브', '모노레포', 'React = 리액트'])
    expect(result.addedCount).toBe(1)
  })
})

describe('readGlossarySettings', () => {
  it('정리한 값을 돌려준다', () => {
    expect(
      readGlossarySettings({ teamDescription: ' 프론트엔드팀 ', terms: ['React', 'react', ''] })
    ).toEqual({ teamDescription: '프론트엔드팀', terms: ['React'] })
  })

  it('형식이 틀리면 거절한다', () => {
    expect(() => readGlossarySettings(null)).toThrow()
    expect(() => readGlossarySettings({ teamDescription: '', terms: 'React' })).toThrow()
    expect(() => readGlossarySettings({ teamDescription: '', terms: [1] })).toThrow()
  })

  it('한도를 넘으면 거절한다', () => {
    expect(() =>
      readGlossarySettings({ teamDescription: '가'.repeat(GLOSSARY_TEAM_MAX_CHARS + 1), terms: [] })
    ).toThrow()
    expect(() =>
      readGlossarySettings({
        teamDescription: '',
        terms: ['가'.repeat(GLOSSARY_TERM_MAX_CHARS + 1)]
      })
    ).toThrow()
    expect(() =>
      readGlossarySettings({
        teamDescription: '',
        terms: Array.from({ length: GLOSSARY_MAX_TERMS + 1 }, (_, index) => `용어${index}`)
      })
    ).toThrow()
  })
})

describe('readTeamDescription', () => {
  it('비어 있으면 거절한다', () => {
    expect(() => readTeamDescription({ teamDescription: '   ' })).toThrow()
    expect(readTeamDescription({ teamDescription: ' 마케팅팀 ' })).toBe('마케팅팀')
  })
})

describe('buildGlossaryDraftPrompt', () => {
  it('팀 소개를 프롬프트에 넣는다', () => {
    expect(buildGlossaryDraftPrompt({ teamDescription: '신약 개발 임상팀' })).toContain(
      '신약 개발 임상팀'
    )
  })
})
