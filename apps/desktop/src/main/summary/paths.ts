import path from 'node:path'
import { app } from 'electron'

/**
 * 요약 중에만 쓰는 프롬프트·출력 파일 자리. 잡이 끝나면 실패해도 지운다 —
 * 회의록에서 다시 만들 수 있는 파생물이다 (references/architecture.md).
 */
export const summaryWorkDir = ({ meetingId }: { meetingId: string }) =>
  path.join(app.getPath('userData'), 'summaries', meetingId)
