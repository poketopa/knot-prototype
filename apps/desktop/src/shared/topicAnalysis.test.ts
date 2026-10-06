import { describe, expect, it } from 'vitest'

import {
  assertTopicCatalogFits,
  buildTopicChunkPrompt,
  buildTopicReducePrompt,
  buildTopicWholePrompt,
  parseTopicAnalysis,
  splitTopicAnalysisUtterances,
  TOPIC_ANALYSIS_PROMPT_VERSION,
  TOPIC_ANALYSIS_PROMPT_VERSION_BY_VARIANT,
  TOPIC_ANALYSIS_SYSTEM_PROMPT,
  TOPIC_ANALYSIS_SYSTEM_PROMPT_B,
  topicAnalysisPromptVersionForVariant,
  topicAnalysisSystemPromptForVariant
} from './summary'
import type { TopicAnalysisDocument, TopicAnalysisUtterance } from './types'

const utterances: TopicAnalysisUtterance[] = [
  {
    id: 'u1',
    speakerLabel: '화자 1',
    text: '녹음 파일은 종료 후 바로 업로드하고 처리 상태를 보여주면 좋겠습니다.',
    startSec: 1
  },
  {
    id: 'u2',
    speakerLabel: '화자 2',
    text: '기다리는 시간을 줄이려면 파일을 나누어 보내는 방법도 검토해야 합니다.',
    startSec: 7
  },
  { id: 'u3', speakerLabel: '화자 1', text: 'C는 오늘 논의하지 않습니다.', startSec: 11 }
]

const documents: TopicAnalysisDocument[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    domain: '운동 기록',
    title: '러닝 루틴',
    overview: '이전 녹음의 누적 문서'
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    domain: '제품 탐색',
    title: '녹음 업로드 검증',
    overview: '녹음과 업로드 흐름을 확인했다.'
  }
]

const rawResult = JSON.stringify({
  schemaVersion: 2,
  topics: [
    {
      documentId: null,
      domain: '프로덕트',
      title: '녹음 파일 업로드와 처리 속도',
      summarySections: [
        {
          heading: '먼저 구현할 방식',
          text: '녹음 종료 후 파일을 업로드하고 처리 상태를 보여주는 흐름을 논의했다.',
          sourceUtteranceIds: ['u1']
        }
      ],
      outline: [
        {
          heading: '논의 상세',
          items: [
            {
              text: '대기 시간을 줄이는 대안으로 파일 분할 전송을 검토했다.',
              sourceUtteranceIds: ['u2']
            }
          ]
        }
      ]
    }
  ]
})

describe('topic analysis prompts', () => {
  it('A 프롬프트는 기존 topic-analysis-v4 문구를 그대로 유지한다', () => {
    expect(TOPIC_ANALYSIS_PROMPT_VERSION_BY_VARIANT.A).toBe(TOPIC_ANALYSIS_PROMPT_VERSION)
    expect(topicAnalysisPromptVersionForVariant('A')).toBe('topic-analysis-v4')
    expect(topicAnalysisSystemPromptForVariant('A')).toBe(TOPIC_ANALYSIS_SYSTEM_PROMPT)
    expect(TOPIC_ANALYSIS_SYSTEM_PROMPT).toBe(
      [
        '당신은 한국어 회의록에서 주제별 문서 초안을 구조화하는 도우미입니다.',
        '회의록에 실제로 나온 내용만 사용합니다.',
        '회의록에 없는 후속 구현 사실, 확정되지 않은 추측, 외부 지식, 날짜, 숫자, 사람 이름을 만들지 않습니다.',
        '한 회의에서 여러 주제가 나오면 주제마다 별도 topic으로 나눕니다.',
        '같은 주제가 기존 문서 목록에 있어도 기존 문서 id를 사용하지 않습니다. 이번 녹음의 주제마다 새 문서를 만듭니다.',
        'documentId는 null로 출력합니다. 앱이 검증 뒤 새 UUID를 배정합니다.',
        'domain은 이 사용자의 문서를 탐색하기 위한 최상위 큰 분류입니다. 고정된 분류표는 없습니다.',
        '기존 문서 목록에 의미가 같은 큰 분류가 있으면 그 domain 값을 그대로 재사용하고, 맞는 분류가 없을 때만 새 큰 분류를 만듭니다.',
        'domain은 주제 제목이 아니라 여러 회의를 묶을 수 있는 넓은 이름이어야 합니다. title에 구체 주제를 적습니다.',
        'title은 문서 제목입니다. 회의에서 논의한 구체 주제를 한눈에 알 수 있게 씁니다.',
        'summarySections와 outline은 화면에서 하나의 문서 흐름으로 이어집니다. 고정 템플릿을 채우지 말고 회의 내용에 맞는 여러 heading을 직접 고릅니다.',
        'heading 예시는 핵심 요약, 결정, 적용 범위, 이유, 할 일, 미결정 항목, 배경, 우려, 대안입니다. 해당 내용이 회의에 없으면 그 heading을 만들지 않습니다.',
        '긴 회의나 중요한 논의는 한두 문장으로 축약하지 말고, 읽는 사람이 세부 전문을 열지 않아도 맥락·근거·결론·남은 질문을 이해할 만큼 충분히 씁니다.',
        'summarySections에는 가장 먼저 봐야 할 핵심 섹션을, outline에는 이어서 읽을 구체 섹션을 둡니다. 두 배열 모두 같은 문서의 동등한 섹션입니다.',
        '각 summarySections 항목과 outline.items 항목에는 근거가 된 sourceUtteranceIds를 1개 이상 넣습니다.',
        'sourceUtteranceIds에는 회의록의 SOURCE_ID 값만 사용합니다. time 값이나 speaker 값은 넣지 않습니다.',
        'SOURCE_ID는 입력으로 받은 값만 사용합니다.',
        '어떤 주제를 오늘 논의하지 않았다는 언급만 있으면 그 주제의 topic을 만들지 않습니다.',
        '일상 대화나 정보 공유도 나중에 다시 볼 의미가 있으면 topic으로 만듭니다. 의미 있는 논의가 없으면 topics를 빈 배열로 둡니다.',
        '항상 JSON만 출력합니다. 설명, 인사말, 코드펜스를 붙이지 않습니다.'
      ].join('\n')
    )
  })

  it('B 프롬프트는 핵심 요약 뒤 결정·보류·미결정·할 일 규칙을 고정한다', () => {
    const wholePrompt = buildTopicWholePrompt({ utterances, documents, variant: 'B' })
    const chunkPrompt = buildTopicChunkPrompt({
      utterances,
      documents,
      index: 0,
      total: 2,
      variant: 'B'
    })
    const reducePrompt = buildTopicReducePrompt({
      documents,
      partials: [{ schemaVersion: 2, topics: [] }],
      variant: 'B'
    })

    expect(TOPIC_ANALYSIS_PROMPT_VERSION_BY_VARIANT.B).toBe('topic-analysis-v4b-sectioned')
    expect(topicAnalysisSystemPromptForVariant('B')).toBe(TOPIC_ANALYSIS_SYSTEM_PROMPT_B)
    expect(TOPIC_ANALYSIS_SYSTEM_PROMPT_B).toContain(
      '맨 위 핵심 요약 다음에는 아래 네 섹션을 이 순서로 둡니다'
    )
    expect(TOPIC_ANALYSIS_SYSTEM_PROMPT_B).toContain(
      '결정: 참석자가 합의했거나, 정할 사람이 확정한 것'
    )
    expect(TOPIC_ANALYSIS_SYSTEM_PROMPT_B).toContain(
      '보류: 하기로 했지만 "나중에", "~하면 그때"처럼 시점이나 조건이 붙은 것'
    )
    expect(TOPIC_ANALYSIS_SYSTEM_PROMPT_B).toContain(
      '요청이나 제안만 나오고 받아들일지 논의하지 않은 것은 미결정이 아닙니다'
    )
    expect(TOPIC_ANALYSIS_SYSTEM_PROMPT_B).toContain(
      '맡은 사람은 회의에서 분명할 때만, 기한은 회의에서 나왔을 때만'
    )
    expect(`${wholePrompt}\n${chunkPrompt}\n${reducePrompt}`).toContain(
      '첫 섹션은 핵심 요약으로 두고'
    )
    expect(`${wholePrompt}\n${chunkPrompt}\n${reducePrompt}`).toContain(
      '결정, 보류, 미결정, 할 일을 해당 내용이 있을 때만 이 순서로'
    )
    expect(`${wholePrompt}\n${chunkPrompt}\n${reducePrompt}`).not.toContain(
      '회의에 맞는 heading을 여러 개 고르고'
    )
  })

  it('기존 문서 목록은 도메인 참고로만 넣고 모델용 SOURCE_ID를 프롬프트에 넣는다', () => {
    const prompt = buildTopicWholePrompt({ utterances, documents })

    expect(prompt).toContain(documents[0].id)
    expect(prompt).toContain('운동 기록 / 러닝 루틴')
    expect(prompt).toContain('제품 탐색 / 녹음 업로드 검증')
    expect(prompt).toContain('SOURCE_ID=S001')
    expect(prompt).toContain('time=00:00:01')
    expect(prompt).not.toContain('{u1}')
    expect(prompt).toContain('"schemaVersion": 2')
    expect(prompt).toContain('"documentId": null')
    expect(prompt).toContain('기존 문서 id를 결과에 쓰지')
    expect(prompt).toContain('이 사용자가 이미 쓰는 큰 분류')
    expect(prompt).toContain('고정된 분류표는 없습니다')
  })

  it('도메인이 없는 기존 문서는 제목을 도메인처럼 중복해서 보여주지 않는다', () => {
    const prompt = buildTopicWholePrompt({
      utterances,
      documents: [{ id: 'doc-without-domain', title: '온보딩 회고' }]
    })

    expect(prompt).toContain('doc-without-domain: 온보딩 회고')
    expect(prompt).not.toContain('온보딩 회고 / 온보딩 회고')
  })

  it('동적 heading과 상세 outline을 요구하고 unsupported claim을 금지한다', () => {
    const chunkPrompt = buildTopicChunkPrompt({ utterances, documents, index: 0, total: 2 })
    const reducePrompt = buildTopicReducePrompt({
      documents,
      partials: [{ schemaVersion: 2, topics: [] }]
    })

    expect(chunkPrompt).toContain('2개 구간 중 1번째')
    expect(`${chunkPrompt}\n${reducePrompt}`).toContain('summarySections')
    expect(`${chunkPrompt}\n${reducePrompt}`).toContain('outline')
    expect(`${chunkPrompt}\n${reducePrompt}`).toContain('회의록에 없는 구현 완료')
    expect(`${chunkPrompt}\n${reducePrompt}`).not.toContain('결정 사항')
    expect(`${chunkPrompt}\n${reducePrompt}`).not.toContain('5개 이내')
    expect(`${chunkPrompt}\n${reducePrompt}`).not.toContain('문서, AI, 개발, 탐색, 독서')
  })

  it('reduce 프롬프트에는 앱이 만든 문서 id를 노출하지 않고 source id를 alias로 바꾼다', () => {
    const prompt = buildTopicReducePrompt({
      documents,
      utterances,
      partials: [
        {
          schemaVersion: 2,
          topics: [
            {
              documentId: 'app-assigned-id',
              domain: '프로덕트',
              title: '새 주제',
              summarySections: [
                {
                  heading: '핵심',
                  text: '더 논의한다.',
                  sourceUtteranceIds: ['u2']
                }
              ],
              outline: [
                {
                  heading: '상세',
                  items: [{ text: '검토가 남았다.', sourceUtteranceIds: ['u2'] }]
                }
              ]
            }
          ]
        }
      ]
    })

    expect(prompt).not.toContain('app-assigned-id')
    expect(prompt).not.toContain('"u2"')
    expect(prompt).toContain('"S002"')
    expect(prompt).toContain('"documentId":null')
  })
})

describe('assertTopicCatalogFits', () => {
  it('기존 문서 목록이 예산보다 크면 조용히 누락하지 않고 실패한다', () => {
    expect(() =>
      assertTopicCatalogFits({
        documents: [{ id: 'doc-1', title: 'A'.repeat(40) }],
        budgetChars: 10
      })
    ).toThrow(/기존 문서 목록/)
  })
})

describe('splitTopicAnalysisUtterances', () => {
  it('발화 단위로만 나누고 모든 id를 보존한다', () => {
    const chunks = splitTopicAnalysisUtterances({ utterances, budgetChars: 120 })

    expect(chunks.flat().map((utterance) => utterance.id)).toEqual(['u1', 'u2', 'u3'])
    chunks.forEach((chunk) => expect(chunk.length).toBeGreaterThan(0))
  })

  it('예산보다 긴 발화도 원문과 근거 id를 모두 보존해 나눈다', () => {
    const original = { id: 'long', speakerLabel: '화자 1', text: '긴 발화입니다.'.repeat(200) }
    const chunks = splitTopicAnalysisUtterances({ utterances: [original], budgetChars: 200 })
    expect(chunks.length).toBeGreaterThan(1)
    expect(
      chunks
        .flat()
        .map((utterance) => utterance.text)
        .join('')
    ).toBe(original.text)
    expect(chunks.flat().every((utterance) => utterance.id === original.id)).toBe(true)
    expect(chunks.flat().every((utterance) => !/\uFFFD/.test(utterance.text))).toBe(true)
  })
})

describe('parseTopicAnalysis', () => {
  it('내용 없는 보류·미결정·할 일 섹션을 생략하고 나머지 내용과 순서를 보존한다', () => {
    const raw = JSON.parse(rawResult)
    const decision = {
      heading: '결정',
      items: [{ text: '선택한 정리만 발행한다.', sourceUtteranceIds: ['S001'] }]
    }
    const background = raw.topics[0].outline[0]
    raw.topics[0].outline = [
      decision,
      { heading: '보류', items: [] },
      { heading: '미결정', items: [] },
      { heading: '할 일', items: [] },
      background
    ]
    const parsed = parseTopicAnalysis({
      raw: JSON.stringify(raw),
      utterances,
      documents,
      createDocumentId: () => 'app-id'
    })
    if (parsed.schemaVersion !== 2) throw new Error('expected V2')
    expect(parsed.topics[0].outline).toEqual([
      { ...decision, items: [{ ...decision.items[0], sourceUtteranceIds: ['u1'] }] },
      background
    ])
    expect(parsed.topics[0].summarySections).toEqual(raw.topics[0].summarySections)
  })

  it('outline이 모두 비어 있어도 핵심 요약이 있으면 보존한다', () => {
    const raw = JSON.parse(rawResult)
    raw.topics[0].outline = [{ heading: '할 일', items: [] }]
    const parsed = parseTopicAnalysis({
      raw: JSON.stringify(raw),
      utterances,
      documents,
      createDocumentId: () => 'app-id'
    })
    if (parsed.schemaVersion !== 2) throw new Error('expected V2')
    expect(parsed.topics[0].outline).toEqual([])
    expect(parsed.topics[0].summarySections).toHaveLength(1)
  })

  it('빈 섹션을 제거한 뒤 정리 내용이 전혀 없으면 거절한다', () => {
    const raw = JSON.parse(rawResult)
    raw.topics[0].summarySections = []
    raw.topics[0].outline = [{ heading: '할 일', items: [] }]
    expect(() =>
      parseTopicAnalysis({
        raw: JSON.stringify(raw),
        utterances,
        documents,
        createDocumentId: () => 'app-id'
      })
    ).toThrow(/정리 내용이 없습니다/)
  })

  it.each([undefined, null, {}])('items가 배열이 아닌 섹션은 여전히 거절한다 (%s)', (items) => {
    const raw = JSON.parse(rawResult)
    raw.topics[0].outline = [{ heading: '할 일', items }]
    expect(() =>
      parseTopicAnalysis({
        raw: JSON.stringify(raw),
        utterances,
        documents,
        createDocumentId: () => 'app-id'
      })
    ).toThrow(/items/)
  })

  it('빈 섹션이 있어도 내용이 있는 섹션의 잘못된 근거는 거절한다', () => {
    const raw = JSON.parse(rawResult)
    raw.topics[0].outline.unshift({ heading: '할 일', items: [] })
    raw.topics[0].outline[1].items[0].sourceUtteranceIds = ['unknown']
    expect(() =>
      parseTopicAnalysis({
        raw: JSON.stringify(raw),
        utterances,
        documents,
        createDocumentId: () => 'app-id'
      })
    ).toThrow(/알 수 없는 발화 id/)
  })

  it('V2 모델용 SOURCE_ID를 원래 발화 id로 되돌리고 앱 UUID를 배정한다', () => {
    const parsed = parseTopicAnalysis({
      raw: rawResult.replaceAll('"u1"', '"S001"').replaceAll('"u2"', '"S002"'),
      utterances,
      documents,
      createDocumentId: () => '22222222-2222-4222-8222-222222222222'
    })

    expect(parsed.schemaVersion).toBe(2)
    if (parsed.schemaVersion !== 2) throw new Error('expected V2')
    expect(parsed.topics[0].documentId).toBe('22222222-2222-4222-8222-222222222222')
    expect(parsed.topics[0].domain).toBe('프로덕트')
    expect(parsed.topics[0].summarySections[0].sourceUtteranceIds).toEqual(['u1'])
    expect(parsed.topics[0].outline[0].items[0].sourceUtteranceIds).toEqual(['u2'])
    expect(parsed.topics[0]).not.toHaveProperty('existingDocumentId')
    expect(parsed.topics[0]).not.toHaveProperty('newDocumentId')
    expect(parsed.topics[0]).not.toHaveProperty('decisions')
    expect(parsed.topics[0]).not.toHaveProperty('unresolved')
  })

  it('V2 결과의 개인화 도메인을 앱 고정 분류로 다시 투영하지 않는다', () => {
    const parsed = parseTopicAnalysis({
      raw: JSON.stringify({
        schemaVersion: 2,
        topics: [
          {
            documentId: null,
            domain: '녹음 분석 품질과 AI 성능 개선',
            title: '화자 분리 모델 개선',
            summarySections: [
              {
                heading: '핵심 요약',
                text: '녹음 분석 품질과 AI 성능 개선을 사용자 문서의 큰 분류로 유지한다.',
                sourceUtteranceIds: ['S001']
              }
            ],
            outline: [
              {
                heading: '논의 상세',
                items: [
                  {
                    text: '화자 분리 모델 실험을 다음 후보로 언급했다.',
                    sourceUtteranceIds: ['S002']
                  }
                ]
              }
            ]
          }
        ]
      }),
      utterances,
      documents,
      createDocumentId: () => '44444444-4444-4444-8444-444444444444'
    })

    expect(parsed.schemaVersion).toBe(2)
    if (parsed.schemaVersion !== 2) throw new Error('expected V2')
    expect(parsed.topics[0].domain).toBe('녹음 분석 품질과 AI 성능 개선')
  })

  it('모델이 새 문서 id를 직접 만들면 거절한다', () => {
    const raw = rawResult.replace('"documentId":null', '"documentId":"model-made-id"')

    expect(() =>
      parseTopicAnalysis({ raw, utterances, documents, createDocumentId: () => 'app-id' })
    ).toThrow(/새 문서/)
  })

  it('알 수 없는 발화 id를 거절한다', () => {
    expect(() =>
      parseTopicAnalysis({
        raw: rawResult.replace('"u1"', '"missing-utterance"'),
        utterances,
        documents,
        createDocumentId: () => 'app-id'
      })
    ).toThrow(/알 수 없는 발화 id/)
  })

  it('타임스탬프를 발화 id처럼 넣으면 거절한다', () => {
    expect(() =>
      parseTopicAnalysis({
        raw: rawResult.replace('"u1"', '"00:00:01"'),
        utterances,
        documents,
        createDocumentId: () => 'app-id'
      })
    ).toThrow(/알 수 없는 발화 id/)
  })

  it('legacy V1 결과도 읽을 수 있다', () => {
    const parsed = parseTopicAnalysis({
      raw: JSON.stringify({
        schemaVersion: 1,
        topics: [
          {
            existingDocumentId: documents[0].id,
            newDocumentId: null,
            title: 'A 도메인',
            overview: 'A 배포 포함 여부를 결정했다.',
            decisions: [{ text: 'A는 다음 배포에 포함한다.', sourceUtteranceIds: ['S001'] }],
            unresolved: []
          }
        ]
      }),
      utterances,
      documents,
      createDocumentId: () => '22222222-2222-4222-8222-222222222222'
    })

    expect(parsed.schemaVersion).toBe(1)
    if (parsed.schemaVersion !== 1) throw new Error('expected V1')
    expect(parsed.topics[0].existingDocumentId).toBe(documents[0].id)
    expect(parsed.topics[0].decisions[0].sourceUtteranceIds).toEqual(['u1'])
  })
})
