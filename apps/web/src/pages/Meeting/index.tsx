import { Navigate, useParams } from 'react-router'

import { PATHS } from '../../routes/paths'
import { useJob } from '../../state/jobContext'
import { useMeetings } from '../../state/meetingsContext'
import Processing from './Processing'
import Result from './Result'

/** 기록 하나. 끝났으면 회의록, 아니면 처리 화면 (계획 §10 "라우트") */
export default function Meeting() {
  const { id } = useParams()
  const { meetings, isLoaded } = useMeetings()
  const { job } = useJob()
  const meeting = meetings.find((candidate) => candidate.id === id)

  if (!isLoaded) return null
  if (!meeting) return <Navigate to={PATHS.home} replace />

  const isRunning = job?.meetingId === meeting.id
  if (meeting.status === 'done' && !isRunning) return <Result meeting={meeting} />

  return <Processing meeting={meeting} job={isRunning ? job : null} />
}
