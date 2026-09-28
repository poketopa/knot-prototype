// STT 결과를 사람이 검토한 정답 전사본과 글자 단위로 비교한다 (CER).
// 띄어쓰기·문장부호·줄바꿈은 전사자마다 달라 점수를 흐리므로 글자와 숫자만 남기고 비교한다.

const NON_TEXT_PATTERN = /[^\p{L}\p{N}]/gu
/** 전사본에서 알아듣지 못한 구간 표시. 채점에서 뺀다 */
const UNKNOWN_MARK_PATTERN = /\[\?\]/g

export const normalizeForCer = (text: string) =>
  text
    .normalize('NFC')
    .replace(UNKNOWN_MARK_PATTERN, '')
    .toLowerCase()
    .replace(NON_TEXT_PATTERN, '')

interface CerParams {
  hypothesis: string
  reference: string
}

/**
 * 편집 거리를 치환·삭제·삽입으로 나눠 센다. 행렬 전체를 들고 있으면 4만 자 × 4만 자라
 * 메모리가 모자라므로 두 행만 굴리고, 각 칸에 비용 대신 세 종류의 개수를 담는다 (비용 = 합).
 */
export const computeCer = ({ hypothesis, reference }: CerParams) => {
  const hyp = [...normalizeForCer(hypothesis)]
  const ref = [...normalizeForCer(reference)]
  const width = hyp.length + 1

  let prevSub = new Int32Array(width)
  let prevDel = new Int32Array(width)
  let prevIns = Int32Array.from({ length: width }, (_, j) => j)
  let curSub = new Int32Array(width)
  let curDel = new Int32Array(width)
  let curIns = new Int32Array(width)

  for (let i = 1; i <= ref.length; i += 1) {
    curSub[0] = 0
    curDel[0] = i
    curIns[0] = 0
    const refChar = ref[i - 1]

    for (let j = 1; j < width; j += 1) {
      const isSame = hyp[j - 1] === refChar
      const diagCost = prevSub[j - 1] + prevDel[j - 1] + prevIns[j - 1] + (isSame ? 0 : 1)
      const delCost = prevSub[j] + prevDel[j] + prevIns[j] + 1
      const insCost = curSub[j - 1] + curDel[j - 1] + curIns[j - 1] + 1

      if (diagCost <= delCost && diagCost <= insCost) {
        curSub[j] = prevSub[j - 1] + (isSame ? 0 : 1)
        curDel[j] = prevDel[j - 1]
        curIns[j] = prevIns[j - 1]
      } else if (delCost <= insCost) {
        curSub[j] = prevSub[j]
        curDel[j] = prevDel[j] + 1
        curIns[j] = prevIns[j]
      } else {
        curSub[j] = curSub[j - 1]
        curDel[j] = curDel[j - 1]
        curIns[j] = curIns[j - 1] + 1
      }
    }

    ;[prevSub, curSub] = [curSub, prevSub]
    ;[prevDel, curDel] = [curDel, prevDel]
    ;[prevIns, curIns] = [curIns, prevIns]
  }

  const substitutions = prevSub[width - 1]
  const deletions = prevDel[width - 1]
  const insertions = prevIns[width - 1]

  return {
    cer: ref.length ? (substitutions + deletions + insertions) / ref.length : 0,
    substitutions,
    deletions,
    insertions,
    referenceChars: ref.length,
    hypothesisChars: hyp.length
  }
}
