import { spawn } from 'node:child_process'
import { networkInterfaces } from 'node:os'

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
// LAN clients load Vite using this machine's address, so their WebSocket
// Origin must be allowed by the backend as well as localhost.
const hosts = new Set(['localhost', '127.0.0.1'])
for (const addresses of Object.values(networkInterfaces())) {
  for (const address of addresses ?? []) {
    if (address.family === 'IPv4') hosts.add(address.address)
  }
}
const allowedOrigins = [...hosts].flatMap(host => [5173, 3001].map(port => `http://${host}:${port}`)).join(',')
const children = [
  spawn(npm, ['run', 'dev:server'], {
    stdio: 'inherit',
    env: { ...process.env, ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ?? allowedOrigins },
  }),
  spawn(npm, ['run', 'dev:client'], { stdio: 'inherit' }),
]
let stopping = false

function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill('SIGTERM')
  setTimeout(() => process.exit(code), 150).unref()
}

for (const child of children) {
  child.on('exit', (code, signal) => {
    if (!stopping) stop(code ?? (signal ? 1 : 0))
  })
  child.on('error', () => stop(1))
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
