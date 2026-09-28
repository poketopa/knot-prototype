/** 브라우저 다운로드로 파일을 내려준다 */

/** `click()` 직후에 revoke하면 다운로드가 시작되기 전에 URL이 사라지는 브라우저가 있다 */
const REVOKE_DELAY_MS = 1000

interface DownloadBlobParams {
  blob: Blob
  fileName: string
}

export const downloadBlob = ({ blob, fileName }: DownloadBlobParams) => {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
}
