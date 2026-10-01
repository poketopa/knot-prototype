import UpdateCheck from '@renderer/modules/features/update/UpdateCheck'
import ModelDownloadSection from '@renderer/modules/widgets/model/ModelDownloadSection'
import SummaryModelSection from '@renderer/modules/widgets/model/SummaryModelSection'
import DocumentClassificationSection from '@renderer/modules/widgets/setting/DocumentClassificationSection'
import DocumentReorganizationSection from '@renderer/modules/widgets/setting/DocumentReorganizationSection'
import LlmSection from '@renderer/modules/widgets/setting/LlmSection'
import SettingsSection from '@renderer/modules/widgets/setting/SettingsSection'
import PageToc from '@renderer/shared/components/composites/PageToc'
import SettingGroup from '@renderer/shared/components/primitives/layout/SettingGroup'
import TopBar from '@renderer/shared/components/primitives/layout/TopBar'

import styles from './index.module.css'

export default function Settings() {
  return (
    <>
      <TopBar title="설정" />
      <PageToc label="설정 목차">
        <div className={styles.page}>
          <h1 className={styles.title}>설정</h1>
          <SettingsSection>
            <SettingGroup title="음성 인식 모델">
              <ModelDownloadSection variant="setting" />
            </SettingGroup>
            {/* widgets는 widgets를 import하지 않으므로 로컬 모델 파일 행은 페이지가 슬롯으로 넘긴다 */}
            <LlmSection localModelSlot={<SummaryModelSection />} />
            <DocumentReorganizationSection />
            <DocumentClassificationSection />
            <SettingGroup title="업데이트">
              <UpdateCheck />
            </SettingGroup>
          </SettingsSection>
        </div>
      </PageToc>
    </>
  )
}
