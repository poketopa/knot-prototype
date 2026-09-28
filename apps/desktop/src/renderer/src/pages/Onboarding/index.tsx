import { useState } from 'react'
import ModelDownloadSection from '@renderer/modules/widgets/model/ModelDownloadSection'
import SummaryModelSection from '@renderer/modules/widgets/model/SummaryModelSection'
import LlmSection from '@renderer/modules/widgets/setting/LlmSection'
import { completeSetupApi } from '@renderer/shared/api/setup'
import Button from '@renderer/shared/components/primitives/ui/Button'
import Icon from '@renderer/shared/components/primitives/ui/Icon'
import { INITIAL_SETUP_PROVIDERS } from '@shared/llm'

import styles from './index.module.css'

const FEATURES = [
  'GitHub 계정으로 나만의 문서 보관',
  '기기에서 전사하고 선택한 AI로 주제별 정리',
  '녹음 파일·전사 원본·AI 정리본 계속 보관'
]

interface OnboardingProps {
  onComplete?: () => void
}

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState<'stt' | 'ai'>('stt')
  const [isCompleting, setIsCompleting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleComplete = async () => {
    setIsCompleting(true)
    setErrorMessage(null)

    try {
      await completeSetupApi()
      onComplete?.()
    } catch (caught) {
      setErrorMessage(caught instanceof Error ? caught.message : '처음 설정을 완료하지 못했습니다')
    } finally {
      setIsCompleting(false)
    }
  }

  return (
    <div className={styles.page}>
      {/* 신호등이 겹치는 자리. 창을 끄는 영역이다 */}
      <div className={styles.titleBar} />
      <div className={styles.columns}>
        <div className={styles.intro}>
          <span className={styles.eyebrow}>처음 설정</span>
          <h1 className={styles.title}>회의를 기록할 준비를 해요</h1>
          <p className={styles.description}>
            로컬 모델을 사용해 음성 인식·화자 분리를 제한 없이 사용해 보세요.
            <br />
            녹음·전사·AI 정리본은 연결된 서버에 보관합니다. 모델 다운로드 뒤 AI 실행 방식을
            설정하세요.
          </p>
          <ul className={styles.features}>
            {FEATURES.map((feature) => (
              <li key={feature} className={styles.feature}>
                <span className={styles.check}>
                  <Icon name="check" />
                </span>
                {feature}
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.setup}>
          <div className={styles.steps} aria-label="처음 설정 단계">
            <span className={step === 'stt' ? styles.activeStep : styles.doneStep}>
              1. 음성 인식
            </span>
            <span className={step === 'ai' ? styles.activeStep : styles.pendingStep}>2. AI</span>
          </div>
          {step === 'stt' ? (
            <ModelDownloadSection onComplete={() => setStep('ai')} />
          ) : (
            <section className={styles.aiStep} aria-label="AI 설정">
              <LlmSection
                allowedProviders={INITIAL_SETUP_PROVIDERS}
                isDisabled={isCompleting}
                showConnectionCheck={false}
                localModelSlot={<SummaryModelSection isDisabled={isCompleting} />}
              />
              <div className={styles.finish}>
                <Button variant="secondary" onClick={() => setStep('stt')} disabled={isCompleting}>
                  이전
                </Button>
                <p className={styles.finishHint}>
                  로컬 모델 설치 또는 CLI 연결을 확인한 뒤 설정을 완료합니다.
                </p>
                <Button onClick={handleComplete} disabled={isCompleting}>
                  {isCompleting ? '확인하는 중…' : '연결 확인하고 시작'}
                </Button>
              </div>
              {errorMessage ? (
                <p className={styles.error} role="alert">
                  {errorMessage}
                </p>
              ) : null}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
