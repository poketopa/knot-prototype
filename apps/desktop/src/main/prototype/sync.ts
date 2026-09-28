import { flushPrototypeRevocations } from './auth'
import { drainPrototypeOutbox } from './outbox'
import { messageOf, warn } from '../log'

/** A bounded batch each second drains new records and retries even after the first login batch. */
export const startPrototypeSyncWorker = () => {
  let revoking = false
  const sync = () =>
    void drainPrototypeOutbox().catch((caught) => warn(`동기화 대기: ${messageOf(caught)}`))
  const revoke = async () => {
    if (revoking) return
    revoking = true
    try {
      await flushPrototypeRevocations()
    } catch (caught) {
      warn(`세션 폐기 대기: ${messageOf(caught)}`)
    } finally {
      revoking = false
    }
  }
  const syncTimer = setInterval(sync, 1000)
  const revokeTimer = setInterval(() => void revoke(), 60_000)
  syncTimer.unref()
  revokeTimer.unref()
  return () => {
    clearInterval(syncTimer)
    clearInterval(revokeTimer)
  }
}
