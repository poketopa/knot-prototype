import { mkdirSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { prototypeUserRoot } from '../prototype/authState'
import { migrate } from './migrations'

let connection: Database.Database | null = null

/** 첫 호출에 파일을 열고 마이그레이션까지 끝낸다. main 프로세스 전용 */
export const getDb = () => {
  if (connection) return connection

  const root = prototypeUserRoot()
  mkdirSync(root, { recursive: true })
  const db = new Database(path.join(root, 'meetings.db'))
  db.pragma('journal_mode = WAL')
  // ON DELETE CASCADE는 연결마다 켜야 동작한다 (references/pitfalls.md)
  db.pragma('foreign_keys = ON')
  migrate(db)
  connection = db

  return connection
}

export const closeDb = () => {
  connection?.close()
  connection = null
}
