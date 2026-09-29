import { createHashRouter } from 'react-router'
import Documents from '@renderer/pages/Documents'
import RecordingHistory from '@renderer/pages/RecordingHistory'
import Summaries from '@renderer/pages/Summaries'
import DocumentDetail from '@renderer/pages/DocumentDetail'
import Processing from '@renderer/pages/Processing'
import Record from '@renderer/pages/Record'
import Settings from '@renderer/pages/Settings'
import { RequireModels } from './guards'
import { AppShellLayout, MainWindowLayout } from './layout'
import { PATHS } from './paths'

export const router = createHashRouter([
  {
    element: <MainWindowLayout />,
    children: [
      {
        element: <AppShellLayout />,
        children: [
          { path: PATHS.home, element: <Documents /> },
          { path: PATHS.recordingHistory, element: <RecordingHistory /> },
          { path: PATHS.summaries, element: <Summaries /> },
          { path: PATHS.summaryDetail, element: <Summaries /> },
          { path: PATHS.documentDetail, element: <DocumentDetail /> },
          { path: PATHS.meetingDetail, element: <Processing /> },
          { path: PATHS.settings, element: <Settings /> },
          { element: <RequireModels />, children: [{ path: PATHS.record, element: <Record /> }] }
        ]
      }
    ]
  }
])
