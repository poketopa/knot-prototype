import type { PrototypeChangedEvent, PrototypeTrackEventRequest } from '@shared/prototype'
import type { ChoosePrototypeComparisonRequest } from '@shared/ipc'

export const getAuthStateApi = () => window.api.prototype.authState()
export const loginApi = () => window.api.prototype.login()
export const logoutApi = () => window.api.prototype.logout()
export const getDocumentsApi = () => window.api.prototype.listDocuments()
export const reanalyzeDocumentsApi = () => window.api.prototype.reanalyzeDocuments()
export const getDocumentClassificationStateApi = () =>
  window.api.prototype.getDocumentClassificationState()
export const startDocumentClassificationApi = () =>
  window.api.prototype.startDocumentClassification()
export const getSummariesApi = () => window.api.prototype.listSummaries()
export const regenerateSummaryApi = (meetingId: string) =>
  window.api.prototype.regenerateSummary({ meetingId })
export const getDocumentApi = (documentId: string) =>
  window.api.prototype.getDocument({ documentId })
export const getTranscriptApi = (recordingId: string, artifactId?: string) =>
  window.api.prototype.readTranscript(artifactId ? { recordingId, artifactId } : { recordingId })
export const getProcessingApi = () => window.api.prototype.getProcessing()
export const getComparisonApi = (recordingId: string) =>
  window.api.prototype.getComparison({ recordingId })
export const chooseComparisonApi = (payload: ChoosePrototypeComparisonRequest) =>
  window.api.prototype.chooseComparison(payload)
export const retryProcessingApi = (meetingId: string) => window.api.prototype.retry({ meetingId })
export const trackApi = (event: PrototypeTrackEventRequest) => window.api.prototype.track(event)
export const onPrototypeChanged = (listener: (event: PrototypeChangedEvent) => void) =>
  window.api.prototype.onChanged(listener)
