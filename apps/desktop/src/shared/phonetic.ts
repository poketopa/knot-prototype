/**
 * 한글 발음 유사도 (Phase 5-4 교정 가드). 음성 인식 오류는 발음이 비슷한 글자로 나오므로
 * 자모 단위로 풀어 편집 거리를 재면 "카볼 ≈ 타볼"은 가깝고 "등분분서 ≈ 브레이킹 체인지"는 멀다.
 */

const HANGUL_BASE = 0xac00
const HANGUL_LAST = 0xd7a3
const MEDIAL_COUNT = 21
const FINAL_COUNT = 28

const INITIALS = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
const MEDIALS = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'
const FINALS = ' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'

/** 초성 ㅇ은 소리가 없다. 남겨 두면 "탑을"과 "타블"처럼 연음된 표기가 멀어진다 */
const SILENT_INITIAL = 'ㅇ'

/**
 * @description 한글 음절을 자모로 풀고 공백·문장부호는 버립니다. 한글이 아닌 글자는 소문자로 그대로 둡니다.
 * @param text - 풀 문자열
 * @returns 자모(와 비한글 글자) 배열
 * @example
 * toJamo('카볼') // ['ㅋ', 'ㅏ', 'ㅂ', 'ㅗ', 'ㄹ']
 */
export const toJamo = (text: string) =>
  [...text.toLowerCase()].flatMap((char) => {
    const code = char.charCodeAt(0)
    if (code < HANGUL_BASE || code > HANGUL_LAST) return /[\p{L}\p{N}]/u.test(char) ? [char] : []

    const offset = code - HANGUL_BASE
    const initial = INITIALS[Math.floor(offset / (MEDIAL_COUNT * FINAL_COUNT))]
    const medial = MEDIALS[Math.floor(offset / FINAL_COUNT) % MEDIAL_COUNT]
    const final = FINALS[offset % FINAL_COUNT]

    return [initial === SILENT_INITIAL ? '' : initial, medial, final.trim()].filter(Boolean)
  })

/** 편집 거리. 비교 대상은 발화 조각과 용어 발음이라 수십 자모 이내다 */
const editDistance = ({ a, b }: { a: string[]; b: string[] }) => {
  const initialRow = Array.from({ length: b.length + 1 }, (_, j) => j)
  const lastRow = a.reduce((previous, charA, i) => {
    const row = [i + 1]
    b.forEach((charB, j) => {
      row.push(Math.min(previous[j + 1] + 1, row[j] + 1, previous[j] + (charA === charB ? 0 : 1)))
    })
    return row
  }, initialRow)

  return lastRow[b.length]
}

/**
 * @description 두 표기의 발음 유사도를 0~1로 잽니다. 자모 편집 거리를 긴 쪽 길이로 나눈 값의 보수입니다.
 * @param a - 발화에 적힌 표기
 * @param b - 비교할 발음 (한글)
 * @returns 1이면 같은 발음, 0에 가까울수록 다른 발음
 * @example
 * phoneticSimilarity({ a: '카볼', b: '타볼' }) // 0.8
 */
export const phoneticSimilarity = ({ a, b }: { a: string; b: string }) => {
  const jamoA = toJamo(a)
  const jamoB = toJamo(b)
  const longer = Math.max(jamoA.length, jamoB.length)
  if (!longer) return 0

  return 1 - editDistance({ a: jamoA, b: jamoB }) / longer
}

/**
 * @description 문자열에 한글이 아닌 글자(라틴 문자 등)가 있는지 봅니다. 이런 용어는 한글 발음을 따로 구해야 비교할 수 있습니다.
 * @param text - 용어
 * @returns 한글·공백·문장부호만으로 이뤄졌으면 false
 * @example
 * needsReading('tarball') // true
 */
export const needsReading = (text: string) => /[^\s\p{P}가-힣]/u.test(text)
