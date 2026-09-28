import { describe, expect, it } from 'vitest'

import {
  applyRefinePairs,
  buildReadingGrammar,
  buildReadingPrompt,
  buildVerifyGrammar,
  buildVerifyPrompt,
  findRefineCandidates,
  parseReadings,
  parseVerifyOutput,
  splitVerifyBatches,
  VERIFY_BATCH_SIZE
} from './refine'

const source = (id: string, text: string) => ({ id, text })

const pair = (utteranceId: string, from: string, to: string) => ({
  utteranceId,
  from,
  to,
  similarity: 0.8
})

describe('buildReadingPrompt', () => {
  it('읽기를 적지 않은 라틴 문자 용어만 묻는다', () => {
    const prompt = buildReadingPrompt({ glossary: ['tarball', '배포', 'semver = 셈버', ' '] })
    expect(prompt).toContain('- tarball')
    expect(prompt).not.toContain('배포')
    expect(prompt).not.toContain('semver')
  })

  it('물을 용어가 없으면 null이다', () => {
    expect(buildReadingPrompt({ glossary: ['배포', 'diff = 디프'] })).toBeNull()
  })
})

describe('buildReadingGrammar', () => {
  it('물을 용어만 허용하고 따옴표를 이스케이프한다', () => {
    const grammar = buildReadingGrammar({ glossary: ['a"b', '배포'] })
    expect(grammar).toContain('term ::= "a\\"b"')
    expect(grammar).not.toContain('"배포"')
  })
})

describe('parseReadings', () => {
  it('사용자 읽기 > 한글 용어 자체 > 모델 읽기 순으로 쓴다', () => {
    const readings = parseReadings({
      output: 'tarball => 타볼, 타르볼\nsemver => 세이머버\n형식이 깨진 줄',
      glossary: ['tarball', 'semver = 셈버, 시버', '배포', 'GitHub']
    })
    expect(readings.get('tarball')).toEqual(['타볼', '타르볼'])
    expect(readings.get('semver')).toEqual(['셈버', '시버'])
    expect(readings.get('배포')).toEqual(['배포'])
    expect(readings.get('GitHub')).toEqual([])
  })
})

describe('findRefineCandidates', () => {
  const readings = new Map([
    ['tarball', ['타볼']],
    ['배포', ['배포']],
    ['모노레포', ['모노레포']],
    ['peer dependency', ['피어 디펜던시']],
    ['breaking change', ['브레이킹 체인지']],
    ['오토파일럿', ['오토파일럿']],
    ['코파일럿', ['코파일럿']]
  ])
  const find = (text: string) =>
    findRefineCandidates({ sources: [source('u', text)], readings }).map(({ from, to }) => [
      from,
      to
    ])

  it('조사를 떼고 발음이 가까운 부분을 후보로 만든다', () => {
    expect(find('카볼이라고 하면')).toEqual([['카볼', 'tarball']])
    expect(find('대포 파일')).toEqual([['대포', '배포']])
  })

  it('띄어 쓴 발음은 두 어절을 어절끼리 비교한다', () => {
    expect(find('피어 스패던시의 이동')).toEqual([['피어 스패던시', 'peer dependency']])
    expect(find('브레이킹이 되는 케이스')).toEqual([])
  })

  it('이미 맞게 적힌 말, 줄임말, 다른 용어는 후보로 만들지 않는다', () => {
    expect(find('브레이킹 체인지가 있다')).toEqual([])
    expect(find('브레이킹이라고 하는')).toEqual([])
    expect(find('오토파일럿 기준')).toEqual([])
  })

  it('용어의 앞부분만 같다고 맞게 적힌 것으로 보지 않는다', () => {
    expect(find('모노래퍼가 아니라도')).toEqual([['모노래퍼', '모노레포']])
  })

  it('조사까지 품은 창보다 조사를 뗀 형태로 치환한다', () => {
    expect(find('마치 오토파이오처럼 해보자')).toEqual([['오토파이오', '오토파일럿']])
  })

  it('한 발화에서 같은 부분은 한 번만 낸다', () => {
    expect(find('카볼 카볼을')).toEqual([['카볼', 'tarball']])
  })
})

describe('splitVerifyBatches', () => {
  it('배치 크기를 넘지 않게 나눈다', () => {
    const candidates = Array.from({ length: VERIFY_BATCH_SIZE + 1 }, (_, i) =>
      pair(String(i), '카볼', 'tarball')
    )
    expect(splitVerifyBatches({ candidates }).map((batch) => batch.length)).toEqual([
      VERIFY_BATCH_SIZE,
      1
    ])
  })
})

describe('buildVerifyPrompt', () => {
  it('후보마다 문맥 속 의심 부분을 «»로 표시한다', () => {
    const prompt = buildVerifyPrompt({
      batch: [pair('u', '카볼', 'tarball')],
      sources: [source('u', '다운을 받아 카볼을 까서')]
    })
    expect(prompt).toContain('[1] 다운을 받아 «카볼»을 까서 → «카볼»를 "tarball"로?')
  })
})

describe('buildVerifyGrammar', () => {
  it('번호와 순서를 고정하고 O/X만 고르게 한다', () => {
    expect(buildVerifyGrammar({ count: 2 })).toBe(
      'root ::= "[1] " verdict "\\n" "[2] " verdict "\\n"\nverdict ::= "O" | "X"'
    )
  })
})

describe('parseVerifyOutput', () => {
  it('O로 답한 후보만 고르고 빠지거나 깨진 답은 X로 본다', () => {
    const batch = [
      pair('a', '카볼', 'tarball'),
      pair('b', '서버', 'semver'),
      pair('c', '대포', '배포')
    ]
    expect(parseVerifyOutput({ output: '[1] O\n[2] X\n[3] 네', batch })).toEqual([batch[0]])
  })
})

describe('applyRefinePairs', () => {
  it('발화마다 통과한 쌍을 모두 적용하고 바뀐 발화만 돌려준다', () => {
    const sources = [source('a', '카볼을 까서 대포 파일'), source('b', '그대로')]
    expect(
      applyRefinePairs({
        sources,
        pairs: [pair('a', '카볼', 'tarball'), pair('a', '대포', '배포')]
      })
    ).toEqual([
      {
        id: 'a',
        before: '카볼을 까서 대포 파일',
        after: 'tarball을 까서 배포 파일',
        pairs: [
          { from: '카볼', to: 'tarball' },
          { from: '대포', to: '배포' }
        ]
      }
    ])
  })

  it('긴 부분부터 치환해 겹치는 쌍이 서로를 깨지 않는다', () => {
    const [suggestion] = applyRefinePairs({
      sources: [source('a', '피어 스패던시와 스패던시')],
      pairs: [pair('a', '스패던시', 'dependency'), pair('a', '피어 스패던시', 'peer dependency')]
    })
    expect(suggestion.after).toBe('peer dependency와 dependency')
  })
})
