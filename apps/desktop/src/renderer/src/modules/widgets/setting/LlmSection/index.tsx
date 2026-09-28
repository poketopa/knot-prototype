import type { ReactNode } from 'react'
import type { LlmProvider, LlmStatus } from '@shared/types'
import { apiVendorOf } from '@shared/llm'
import SettingGroup from '@renderer/shared/components/primitives/layout/SettingGroup'
import Button from '@renderer/shared/components/primitives/ui/Button'

import { API_KEY_FIELD_COPY, PROVIDER_OPTIONS } from './constants/providers'
import useLlmSettings from './model/useLlmSettings'
import ApiKeyField from './ui/ApiKeyField'
import OpenaiModelSelect from './ui/OpenaiModelSelect'
import ProviderOption from './ui/ProviderOption'
import styles from './index.module.css'

/** Claude Code를 골랐을 때의 준비 상태. 로컬의 준비 상태는 파일 다운로드 행(슬롯)이 스스로 보여준다 */
const renderReadiness = (status: LlmStatus) => {
  if (status.provider === 'codex-cli') {
    if (status.codexCliUnsupportedReason)
      return (
        <p className={styles.warning} role="alert">
          {status.codexCliUnsupportedReason}
        </p>
      )
    return (
      <p className={styles.hint}>
        {status.codexCliPath
          ? `Codex CLI ${status.codexCliVersion ?? ''} · 터미널에서 로그인한 사용자 계정으로 실행합니다.`
          : 'Codex CLI를 설치하고 터미널에서 로그인한 뒤 앱을 다시 켜 주세요.'}{' '}
        <a href="https://developers.openai.com/codex/cli/" target="_blank" rel="noreferrer">
          설치 문서
        </a>
      </p>
    )
  }
  if (status.provider === 'claude-cli') {
    return status.claudeCliPath ? (
      <p className={styles.hint}>
        찾은 명령: <code className={styles.code}>{status.claudeCliPath}</code>
        {status.claudeCliVersion ? ` (${status.claudeCliVersion})` : ''}. 터미널에서 로그인한 계정을
        그대로 씁니다.{' '}
        <a href="https://code.claude.com/docs/en/quickstart" target="_blank" rel="noreferrer">
          로그인 도움말
        </a>
      </p>
    ) : (
      <p className={styles.warning} role="alert">
        claude 명령을 찾을 수 없습니다. Claude Code를 설치하고 터미널에서 한 번 로그인한 뒤 앱을
        다시 켜 주세요.{' '}
        <a href="https://code.claude.com/docs/en/quickstart" target="_blank" rel="noreferrer">
          설치 문서
        </a>
      </p>
    )
  }

  return null
}

interface LlmSectionProps {
  /** 로컬 실행 방식을 골랐을 때 라디오 아래에 끼우는 요약 모델 파일 다운로드 행 (`model/SummaryModelSection`) */
  localModelSlot?: ReactNode
  /** 최초 설정에서는 API 키 공급자를 숨기고, 설정 화면에서는 전체 목록을 보여준다 */
  allowedProviders?: LlmProvider[]
  isDisabled?: boolean
  showConnectionCheck?: boolean
}

/** 요약·용어 초안을 어떤 방식으로 만들지. 기본은 로컬이고, 외부 공급자를 고르면 회의록이 밖으로 나간다 */
export default function LlmSection({
  localModelSlot,
  allowedProviders,
  isDisabled = false,
  showConnectionCheck = true
}: LlmSectionProps) {
  const {
    status,
    isLoading,
    loadError,
    apiKeyInput,
    isSaving,
    isChecking,
    actionError,
    notice,
    setApiKeyInput,
    selectProvider,
    saveApiKey,
    clearApiKey,
    selectOpenaiModel,
    checkConnection
  } = useLlmSettings()

  const renderBody = () => {
    if (isLoading) return <p className={styles.hint}>LLM 설정을 불러오는 중입니다</p>
    if (!status) {
      return (
        <p className={styles.error} role="alert">
          {loadError ?? 'LLM 설정을 불러오지 못했습니다'}
        </p>
      )
    }

    const isBusy = isSaving || isChecking || isDisabled
    const vendor = apiVendorOf(status.provider)
    const providerOptions = allowedProviders
      ? PROVIDER_OPTIONS.filter((option) => allowedProviders.includes(option.value))
      : PROVIDER_OPTIONS
    const isProviderAllowed = !allowedProviders || allowedProviders.includes(status.provider)

    return (
      <>
        <p className={styles.label}>실행 방식</p>
        <div className={styles.options} role="radiogroup" aria-label="실행 방식">
          {providerOptions.map((option) => (
            <ProviderOption
              key={option.value}
              value={option.value}
              title={option.title}
              description={option.description}
              isSelected={status.provider === option.value}
              isDisabled={isBusy}
              onSelect={() => selectProvider(option.value)}
            />
          ))}
        </div>

        {!isProviderAllowed ? (
          <p className={styles.warning} role="alert">
            실행 방식을 선택해 주세요.
          </p>
        ) : null}
        {isProviderAllowed && status.provider === 'local' && localModelSlot}
        {isProviderAllowed && vendor && (
          <ApiKeyField
            label={API_KEY_FIELD_COPY[vendor].label}
            hint={API_KEY_FIELD_COPY[vendor].hint}
            placeholder={API_KEY_FIELD_COPY[vendor].placeholder}
            value={apiKeyInput}
            hasSavedKey={status.apiKeys[vendor].isSaved}
            savedKeyTail={status.apiKeys[vendor].tail}
            isDisabled={isBusy}
            onChange={setApiKeyInput}
            onSave={() => saveApiKey(vendor)}
            onClear={() => clearApiKey(vendor)}
          />
        )}
        {isProviderAllowed && status.provider === 'openai-api' && (
          <OpenaiModelSelect
            value={status.openaiModel}
            isDisabled={isBusy}
            onChange={selectOpenaiModel}
          />
        )}
        {isProviderAllowed && renderReadiness(status)}

        {isProviderAllowed && showConnectionCheck && status.provider !== 'local' && (
          <div className={styles.actions}>
            <Button variant="secondary" size="sm" onClick={checkConnection} disabled={isBusy}>
              {isChecking ? '확인하는 중…' : '연결 확인'}
            </Button>
            {isChecking && <span className={styles.hint}>짧은 요청 한 번을 보냅니다</span>}
          </div>
        )}

        {notice && (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        )}
        {actionError && (
          <p className={styles.error} role="alert">
            {actionError}
          </p>
        )}
      </>
    )
  }

  return (
    <SettingGroup title="AI 정리">
      <div className={styles.body}>
        <p className={styles.hint}>
          주제별 결정과 미결정 사항을 정리할 AI를 고릅니다. 회의록 작성(음성 인식·화자 분리)은 어느
          쪽을 골라도 이 기기에서만 처리합니다. 진행 중인 요약에는 적용되지 않고 다음 요약부터
          바뀝니다.
        </p>
        {renderBody()}
      </div>
    </SettingGroup>
  )
}
