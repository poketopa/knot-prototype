import type { PrototypeChangedEvent, PrototypeTrackEventRequest } from '@shared/prototype'

export const getAuthStateApi = () => window.api.prototype.authState()
export const loginApi = () => window.api.prototype.login()
export const logoutApi = () => window.api.prototype.logout()
export const getDocumentsApi = () => window.api.prototype.listDocuments()
export const getSummariesApi = () => window.api.prototype.listSummaries()
export const getDocumentApi = (documentId: string) =>
  window.api.prototype.getDocument({ documentId })
export const getTranscriptApi = (recordingId: string) =>
  window.api.prototype.readTranscript({ recordingId })
export const getProcessingApi = () => window.api.prototype.getProcessing()
export const retryProcessingApi = (meetingId: string) => window.api.prototype.retry({ meetingId })
export const trackApi = (event: PrototypeTrackEventRequest) => window.api.prototype.track(event)
export const onPrototypeChanged = (listener: (event: PrototypeChangedEvent) => void) =>
  window.api.prototype.onChanged(listener)
