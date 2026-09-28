import { describe, expect, it } from 'vitest'

import { clusterByCompleteLinkage, cosineDistance, l2Normalize } from './cluster'

const unit = (values: number[]) => l2Normalize(Float32Array.from(values))

describe('l2Normalize', () => {
  it('길이를 1로 만든다', () => {
    const normalized = l2Normalize(Float32Array.from([3, 4]))
    expect(normalized[0]).toBeCloseTo(0.6, 6)
    expect(normalized[1]).toBeCloseTo(0.8, 6)
  })

  it('영벡터는 그대로 둔다', () => {
    expect(Array.from(l2Normalize(Float32Array.from([0, 0])))).toEqual([0, 0])
  })
})

describe('cosineDistance', () => {
  it('같은 방향이면 0, 직교하면 1', () => {
    expect(cosineDistance(unit([1, 0]), unit([2, 0]))).toBeCloseTo(0, 6)
    expect(cosineDistance(unit([1, 0]), unit([0, 1]))).toBeCloseTo(1, 6)
  })
})

describe('clusterByCompleteLinkage', () => {
  it('두 덩어리를 요청한 수만큼 나눈다', () => {
    const embeddings = [
      unit([1, 0.01]),
      unit([1, -0.01]),
      unit([0.99, 0.02]),
      unit([0.01, 1]),
      unit([-0.01, 1])
    ]

    const labels = clusterByCompleteLinkage({ embeddings, clusterCount: 2 })

    expect(labels.slice(0, 3)).toEqual([0, 0, 0])
    expect(labels.slice(3)).toEqual([1, 1])
  })

  it('참석자 수 1이면 전부 한 화자로 묶는다', () => {
    const embeddings = [unit([1, 0]), unit([0, 1]), unit([-1, 0])]
    expect(clusterByCompleteLinkage({ embeddings, clusterCount: 1 })).toEqual([0, 0, 0])
  })

  it('참석자 수가 임베딩 수보다 많으면 임베딩 수만큼만 나눈다', () => {
    const embeddings = [unit([1, 0]), unit([0, 1])]
    expect(clusterByCompleteLinkage({ embeddings, clusterCount: 5 })).toEqual([0, 1])
  })

  it('임베딩이 없으면 빈 배열', () => {
    expect(clusterByCompleteLinkage({ embeddings: [], clusterCount: 3 })).toEqual([])
  })
})
