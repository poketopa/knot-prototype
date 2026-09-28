/**
 * 기록 저장소 — IndexedDB `meeting-stt-web` / `meetings` (계획 §10 "저장").
 * 서버가 없으므로 기록은 이 브라우저(origin)에만 남고, 사이트 데이터를 지우면 함께 사라진다.
 * Blob은 IndexedDB가 참조로 들고 있어 목록을 읽을 때 오디오가 메모리에 올라오지 않는다.
 */

import type { MeetingRecord } from '../types/meeting'

const DB_NAME = 'meeting-stt-web'
const DB_VERSION = 1
const STORE_NAME = 'meetings'
const CREATED_AT_INDEX = 'createdAt'

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('이 브라우저는 기록을 저장할 수 없습니다 (IndexedDB 없음)'))
      return
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
      store.createIndex(CREATED_AT_INDEX, 'createdAt')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('기록 저장소를 열지 못했습니다'))
  })

const awaitRequest = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('기록 저장소 작업이 실패했습니다'))
  })

interface RunTransactionParams<T> {
  mode: IDBTransactionMode
  run: (store: IDBObjectStore) => IDBRequest<T>
}

const runTransaction = async <T>({ mode, run }: RunTransactionParams<T>) => {
  const database = await openDatabase()

  try {
    return await awaitRequest(run(database.transaction(STORE_NAME, mode).objectStore(STORE_NAME)))
  } finally {
    database.close()
  }
}

const isMeetingRecord = (value: unknown): value is MeetingRecord =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as MeetingRecord).id === 'string' &&
  Array.isArray((value as MeetingRecord).utterances)

/** 최근 기록부터 */
export const listMeetings = async () => {
  const rows = await runTransaction<unknown[]>({
    mode: 'readonly',
    run: (store) => store.index(CREATED_AT_INDEX).getAll()
  })

  return rows.filter(isMeetingRecord).toReversed()
}

export const getMeeting = async (id: string) => {
  const row = await runTransaction<unknown>({ mode: 'readonly', run: (store) => store.get(id) })

  return isMeetingRecord(row) ? row : null
}

export const putMeeting = (meeting: MeetingRecord) =>
  runTransaction({ mode: 'readwrite', run: (store) => store.put(meeting) })

/** 저장된 기록의 일부만 바꾼다. 없는 기록이면 아무것도 하지 않는다 */
export const patchMeeting = async ({
  id,
  patch
}: {
  id: string
  patch: Partial<Omit<MeetingRecord, 'id'>>
}) => {
  const current = await getMeeting(id)
  if (!current) return null

  const next = { ...current, ...patch }
  await putMeeting(next)

  return next
}

export const deleteMeeting = (id: string) =>
  runTransaction({ mode: 'readwrite', run: (store) => store.delete(id) })

export const newMeetingId = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
