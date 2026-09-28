import { loadConfig } from './config.js'
import { createPool } from './db.js'
import { buildServer } from './server.js'

const config = loadConfig()
const db = createPool(config.databaseUrl)
const app = buildServer({ config, db })

app.listen({ host: config.host, port: config.port }).catch(async (error) => {
  app.log.error(error)
  await db.end()
  process.exit(1)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    shutdown().catch(() => process.exit(1))
  })
}

async function shutdown() {
  await app.close()
  await db.end()
  process.exit(0)
}
