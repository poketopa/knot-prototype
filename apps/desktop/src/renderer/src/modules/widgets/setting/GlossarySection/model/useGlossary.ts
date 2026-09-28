import { useEffect, useState } from 'react'
import { mergeGlossaryTerms } from '@shared/glossary'
import type { GlossarySettings } from '@shared/types'
import { draftGlossaryApi, getGlossaryApi, updateGlossaryApi } from '@renderer/shared/api/glossary'

import useTermRows from './useTermRows'

const LOAD_ERROR_MESSAGE = '용어 사전을 불러오지 못했습니다'
const SAVE_ERROR_MESSAGE = '용어 사전을 저장하지 못했습니다'
const DRAFT_ERROR_MESSAGE = '용어 초안을 만들지 못했습니다'

const EMPTY_GLOSSARY: GlossarySettings = { teamDescription: '', terms: [] }

const messageOf = ({ caught, fallback }: { caught: unknown; fallback: string }) =>
  caught instanceof Error && caught.message ? caught.message : fallback

/**
 * 설정의 용어 사전 카테고리 상태. 초안은 편집 중인 목록 뒤에 덧붙이기만 하고 저장하지 않는다 —
 * 모델 읽기가 틀릴 수 있어 사용자가 확인한 뒤 저장한다 (references/architecture.md "용어 사전").
 */
const useGlossary = () => {
  const [saved, setSaved] = useState(EMPTY_GLOSSARY)
  const [teamDescription, setTeamDescription] = useState('')
  const { rows, focusId, termLines, resetRows, addRow, updateRow, removeRow, pasteRows } =
    useTermRows()
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isDrafting, setIsDrafting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    getGlossaryApi()
      .then((glossary) => {
        setSaved(glossary)
        setTeamDescription(glossary.teamDescription)
        resetRows(glossary.terms)
      })
      .catch((caught: unknown) => setLoadError(messageOf({ caught, fallback: LOAD_ERROR_MESSAGE })))
      .finally(() => setIsLoading(false))
  }, [resetRows])

  const isDirty =
    teamDescription !== saved.teamDescription || termLines.join('\n') !== saved.terms.join('\n')

  const saveGlossary = async () => {
    setIsSaving(true)
    setActionError(null)
    setNotice(null)

    try {
      const next = await updateGlossaryApi({ teamDescription, terms: termLines })
      setSaved(next)
      setTeamDescription(next.teamDescription)
      resetRows(next.terms)
      setNotice(`용어 ${next.terms.length}개를 저장했습니다`)
    } catch (caught) {
      setActionError(messageOf({ caught, fallback: SAVE_ERROR_MESSAGE }))
    } finally {
      setIsSaving(false)
    }
  }

  const draftTerms = async () => {
    setIsDrafting(true)
    setActionError(null)
    setNotice(null)

    try {
      const { terms: additions } = await draftGlossaryApi({ teamDescription })
      const { terms, addedCount } = mergeGlossaryTerms({ current: termLines, additions })
      resetRows(terms)
      setNotice(
        addedCount
          ? `새 용어 ${addedCount}개를 덧붙였습니다. 읽기가 맞는지 확인하고 저장해 주세요`
          : '새로 덧붙일 용어가 없습니다'
      )
    } catch (caught) {
      setActionError(messageOf({ caught, fallback: DRAFT_ERROR_MESSAGE }))
    } finally {
      setIsDrafting(false)
    }
  }

  return {
    teamDescription,
    rows,
    focusId,
    termCount: termLines.length,
    isLoading,
    loadError,
    isDirty,
    isSaving,
    isDrafting,
    actionError,
    notice,
    setTeamDescription,
    addRow,
    updateRow,
    removeRow,
    pasteRows,
    saveGlossary,
    draftTerms
  }
}

export default useGlossary
