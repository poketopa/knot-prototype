import type { DraftGlossaryRequest, UpdateGlossaryRequest } from '@shared/ipc'

/**
 * @description 전역 용어 사전(팀 소개와 용어 목록)을 불러옵니다.
 * @returns 저장된 팀 소개와 용어 목록
 * @example
 * const { teamDescription, terms } = await getGlossaryApi()
 */
export const getGlossaryApi = async () => window.api.glossary.get()

/**
 * @description 전역 용어 사전을 저장합니다. main이 공백·빈 줄·중복 용어를 정리한 값을 돌려줍니다.
 * @param teamDescription - 팀 소개 (최대 500자)
 * @param terms - 용어 줄 목록. `용어` 또는 `영어 표기 = 읽기1, 읽기2`
 * @returns 정리해 저장한 용어 사전
 * @example
 * const saved = await updateGlossaryApi({ teamDescription, terms: ['GitHub = 깃허브'] })
 */
export const updateGlossaryApi = async ({ teamDescription, terms }: UpdateGlossaryRequest) =>
  window.api.glossary.update({ teamDescription, terms })

/**
 * @description 팀 소개로 용어 초안을 만듭니다. 저장하지 않으며, 다른 회의를 처리 중이면 그 작업이 끝난 뒤 만듭니다.
 * @param teamDescription - 팀 소개
 * @returns 초안 용어 줄 목록
 * @example
 * const { terms } = await draftGlossaryApi({ teamDescription: '프론트엔드 개발팀' })
 */
export const draftGlossaryApi = async ({ teamDescription }: DraftGlossaryRequest) =>
  window.api.glossary.draft({ teamDescription })
