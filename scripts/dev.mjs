import { spawn } from 'node:child_process'

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const children = [
  spawn(npm, ['run', 'dev:server'], { stdio: 'inherit' }),
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
