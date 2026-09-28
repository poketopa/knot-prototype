import pg from 'pg'

export type Db = pg.Pool
export type DbClient = pg.PoolClient

export function createPool(connectionString: string): Db {
  return new pg.Pool({ connectionString, max: 10 })
}

export async function withTransaction<T>(
  db: Db,
  callback: (client: DbClient) => Promise<T>
): Promise<T> {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
