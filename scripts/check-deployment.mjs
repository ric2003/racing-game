import WebSocket from 'ws'

const [endpoint, origin] = process.argv.slice(2)
if (!endpoint || !origin) {
  console.error('Usage: node scripts/check-deployment.mjs <ws-url> <frontend-origin>')
  process.exit(1)
}

const sockets = []
const timer = setTimeout(() => {
  console.error('Timed out creating and joining a room.')
  process.exit(1)
}, 30_000)

function join(action) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint, { origin })
    sockets.push(socket)
    socket.on('error', reject)
    socket.on('open', () => socket.send(JSON.stringify(action)))
    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString())
        if (message.type === 'welcome') resolve(message)
        else if (message.type === 'error') reject(new Error(JSON.stringify(message)))
      } catch (error) {
        reject(error)
      }
    })
    socket.on('close', () => reject(new Error('Connection closed before joining.')))
  })
}

try {
  const host = await join({ type: 'create-room', name: 'DeployHost' })
  const guest = await join({ type: 'join-room', name: 'DeployGuest', roomCode: host.roomCode })
  if (guest.roomCode !== host.roomCode) throw new Error('Players joined different rooms.')
  console.log('PASS: two players connected and joined the same room.')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  clearTimeout(timer)
  for (const socket of sockets) socket.terminate()
}
