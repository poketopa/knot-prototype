const KILOBYTE = 1000
const MEGABYTE = KILOBYTE * 1000
const GIGABYTE = MEGABYTE * 1000

/** 모델 용량 표시용. 배포 문서·레지스트리와 같은 10진 단위(574MB, 2.5GB)를 쓴다 */
export const formatBytes = ({ bytes }: { bytes: number }) => {
  if (bytes >= GIGABYTE) return `${(bytes / GIGABYTE).toFixed(1)}GB`
  if (bytes >= MEGABYTE) return `${Math.round(bytes / MEGABYTE)}MB`
  if (bytes >= KILOBYTE) return `${Math.round(bytes / KILOBYTE)}KB`

  return `${bytes}B`
}
