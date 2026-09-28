import { createBrowserRouter } from 'react-router'

import Home from '../pages/Home'
import Meeting from '../pages/Meeting'
import Record from '../pages/Record'
import Test from '../pages/Test'
import AppShell from '../shell/AppShell'
import { PATHS } from './paths'

/** 정적 호스팅이라 경로가 그대로 URL이 된다. Vercel은 rewrites로 index.html에 돌린다 (계획 §10) */
export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: PATHS.home, element: <Home /> },
      { path: PATHS.record, element: <Record /> },
      { path: PATHS.meetingDetail, element: <Meeting /> }
    ]
  },
  // 리디자인 전 페이지는 셸 밖이다. 자기 녹음·실행 상태를 따로 가진다
  { path: PATHS.test, element: <Test /> }
])
