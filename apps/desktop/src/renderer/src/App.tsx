import { RouterProvider } from 'react-router'
import AuthGate from '@renderer/modules/widgets/prototype/AuthGate'
import SetupGate from '@renderer/modules/widgets/prototype/SetupGate'
import RecordingCommandController from '@renderer/modules/widgets/recording/RecordingCommandController'
import Onboarding from '@renderer/pages/Onboarding'
import { router } from '@renderer/shared/routes'

export default function App() {
  return (
    <AuthGate>
      <SetupGate renderSetup={(onComplete) => <Onboarding onComplete={onComplete} />}>
        <RecordingCommandController />
        <RouterProvider router={router} />
      </SetupGate>
    </AuthGate>
  )
}
