import { Outlet } from 'react-router'

import JobProvider from '../../state/JobProvider'
import MeetingsProvider from '../../state/MeetingsProvider'
import RecordingProvider from '../../state/RecordingProvider'
import Sidebar from '../Sidebar'
import styles from './index.module.css'

/** 사이드바 + 본문 두 칸. 녹음·파이프라인은 화면을 옮겨도 이어져야 하므로 여기서 소유한다 */
export default function AppShell() {
  return (
    <MeetingsProvider>
      <JobProvider>
        <RecordingProvider>
          <div className={styles.shell}>
            <Sidebar />
            <main className={styles.main}>
              <Outlet />
            </main>
          </div>
        </RecordingProvider>
      </JobProvider>
    </MeetingsProvider>
  )
}
