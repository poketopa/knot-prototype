/**
 * @description 이 기기 사용자별 최초 설정 완료 여부를 조회합니다.
 * @returns 완료 여부
 * @example
 * const { isComplete } = await getSetupStatusApi()
 */
export const getSetupStatusApi = async () => window.api.setup.status()

/**
 * @description 필수 STT 모델과 선택한 AI 준비 상태를 main에서 재검증한 뒤 최초 설정을 완료합니다.
 * @returns 완료 여부
 * @example
 * await completeSetupApi()
 */
export const completeSetupApi = async () => window.api.setup.complete()
