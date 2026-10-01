import { createHashRouter } from 'react-router'
import Documents from '@renderer/pages/Documents'
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
          { index: true, element: <Documents /> },
          { path: 'documents/:documentId', element: <DocumentDetail embedded /> },
          { path: PATHS.processing, element: <Processing /> },
          { path: PATHS.meetingDetail, element: <Processing /> },
          { path: PATHS.settings, element: <Settings /> },
          { element: <RequireModels />, children: [{ path: PATHS.record, element: <Record /> }] }
        ]
      }
    ]
  }
])
