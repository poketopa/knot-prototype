import type { WriteClipboardTextRequest } from '@shared/ipc'

/**
 * @description 텍스트를 시스템 클립보드에 복사합니다. main의 clipboard 모듈을 거칩니다.
 * @param text - 복사할 텍스트
 * @returns 없음
 * @example
 * await writeClipboardTextApi({ text: formatTranscript({ utterances }) })
 */
export const writeClipboardTextApi = async ({ text }: WriteClipboardTextRequest) => {
  await window.api.clipboard.writeText({ text })
}
