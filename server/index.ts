import { createGameServer } from './game-server.js'

const port = Number.parseInt(process.env.PORT ?? '3001', 10)
const host = process.env.HOST ?? '0.0.0.0'
const maxConnections = Number.parseInt(process.env.MAX_CONNECTIONS ?? '64', 10)

const server = await createGameServer({ port, host, maxConnections })
console.log(`Neon Apex server ready at http://${host === '0.0.0.0' ? 'localhost' : host}:${server.port}`)

async function shutdown() {
  await server.close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
