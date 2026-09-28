/**
 * 코사인 거리 + complete-linkage 병합형 군집(AHC).
 * 화자 임베딩을 전역으로 한 번에 묶어 창 사이 화자 동일성을 만든다.
 * 클러스터 수는 사용자가 입력한 참석자 수로 고정한다 — 임계값 방식은 녹음이 길수록
 * 화자가 무한정 늘어난다 (docs/phase1-results.md).
 */

/** 임베딩을 L2 정규화한다. 정규화해 두면 코사인 거리가 내적 한 번으로 끝난다 */
export const l2Normalize = (vector: Float32Array) => {
  let sumSquares = 0
  for (let i = 0; i < vector.length; i += 1) sumSquares += vector[i] * vector[i]

  const norm = Math.sqrt(sumSquares)
  if (norm === 0) return vector

  const normalized = new Float32Array(vector.length)
  for (let i = 0; i < vector.length; i += 1) normalized[i] = vector[i] / norm
  return normalized
}

/** L2 정규화된 두 벡터의 코사인 거리 (0~2) */
export const cosineDistance = (a: Float32Array, b: Float32Array) => {
  let dot = 0
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i]
  return 1 - dot
}

const buildDistanceMatrix = (embeddings: Float32Array[]) => {
  const count = embeddings.length
  const matrix = new Float64Array(count * count)

  for (let i = 0; i < count; i += 1) {
    for (let j = i + 1; j < count; j += 1) {
      const distance = cosineDistance(embeddings[i], embeddings[j])
      matrix[i * count + j] = distance
      matrix[j * count + i] = distance
    }
  }

  return matrix
}

/** 클러스터 뿌리 번호를 등장 순서대로 0,1,2...로 다시 매긴다 */
const relabelByFirstAppearance = (roots: number[]) => {
  const order = new Map<number, number>()

  return roots.map((root) => {
    const existing = order.get(root)
    if (existing !== undefined) return existing

    const next = order.size
    order.set(root, next)
    return next
  })
}

interface ClusterParams {
  /** L2 정규화된 임베딩들 */
  embeddings: Float32Array[]
  /** 만들 클러스터 수 (참석자 수) */
  clusterCount: number
}

/**
 * 임베딩마다 0부터 시작하는 클러스터 번호를 돌려준다.
 * 활성 클러스터별 최근접 이웃을 캐시해 두고 병합 때 영향받은 행만 다시 계산한다.
 */
export const clusterByCompleteLinkage = ({ embeddings, clusterCount }: ClusterParams) => {
  const count = embeddings.length
  if (count === 0) return []

  const target = Math.max(1, Math.min(clusterCount, count))
  const matrix = buildDistanceMatrix(embeddings)
  const isActive = new Uint8Array(count).fill(1)
  const roots = embeddings.map((_, index) => index)
  const nearest = new Int32Array(count).fill(-1)
  const nearestDistance = new Float64Array(count).fill(Infinity)

  const refreshNearest = (row: number) => {
    let best = -1
    let bestDistance = Infinity

    for (let column = 0; column < count; column += 1) {
      if (column === row || !isActive[column]) continue
      if (matrix[row * count + column] < bestDistance) {
        bestDistance = matrix[row * count + column]
        best = column
      }
    }

    nearest[row] = best
    nearestDistance[row] = bestDistance
  }

  for (let row = 0; row < count; row += 1) refreshNearest(row)

  let activeCount = count
  while (activeCount > target) {
    let keeper = -1
    let bestDistance = Infinity
    for (let row = 0; row < count; row += 1) {
      if (isActive[row] && nearestDistance[row] < bestDistance) {
        bestDistance = nearestDistance[row]
        keeper = row
      }
    }
    if (keeper === -1) break

    const absorbed = nearest[keeper]
    if (absorbed === -1) break

    // complete linkage: 합친 클러스터와 남의 거리는 두 거리 중 먼 쪽
    for (let column = 0; column < count; column += 1) {
      if (!isActive[column] || column === keeper || column === absorbed) continue
      const merged = Math.max(matrix[keeper * count + column], matrix[absorbed * count + column])
      matrix[keeper * count + column] = merged
      matrix[column * count + keeper] = merged
    }

    isActive[absorbed] = 0
    activeCount -= 1
    for (let index = 0; index < count; index += 1) {
      if (roots[index] === absorbed) roots[index] = keeper
    }

    refreshNearest(keeper)
    for (let row = 0; row < count; row += 1) {
      if (!isActive[row] || row === keeper) continue
      if (nearest[row] === absorbed || nearest[row] === keeper) refreshNearest(row)
    }
  }

  return relabelByFirstAppearance(roots)
}
