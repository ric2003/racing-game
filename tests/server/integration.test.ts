import { connect as connectTcp } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { createGameServer, type RunningGameServer } from '../../server/game-server.js'
import type { ServerMessage } from '../../src/shared/protocol.js'

class TestClient {
  readonly socket: WebSocket
  private messages: ServerMessage[] = []
  private waiters: Array<() => void> = []

  private constructor(socket: WebSocket) {
    this.socket = socket
    socket.on('message', (data) => {
      this.messages.push(JSON.parse(data.toString()) as ServerMessage)
      this.waiters.splice(0).forEach((wake) => wake())
    })
  }

  static async connect(url: string): Promise<TestClient> {
    const socket = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })
    return new TestClient(socket)
  }

  send(message: object): void {
    this.socket.send(JSON.stringify(message))
  }

  sendRaw(message: string): void {
    this.socket.send(message)
  }

  async waitFor<T extends ServerMessage>(predicate: (message: ServerMessage) => message is T): Promise<T> {
    const deadline = Date.now() + 4_000
    while (Date.now() < deadline) {
      const index = this.messages.findIndex(predicate)
      if (index >= 0) return this.messages.splice(index, 1)[0] as T
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 50)
        this.waiters.push(() => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
    throw new Error(`Timed out. Messages: ${JSON.stringify(this.messages)}`)
  }

  async take(count: number): Promise<ServerMessage[]> {
    const deadline = Date.now() + 4_000
    while (Date.now() < deadline) {
      if (this.messages.length >= count) return this.messages.splice(0, count)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 50)
        this.waiters.push(() => {
          clearTimeout(timer)
          resolve()
        })
      })
    }
    throw new Error(`Timed out waiting for ${count} messages. Messages: ${JSON.stringify(this.messages)}`)
  }

  takeAvailable(): ServerMessage[] {
    return this.messages.splice(0)
  }

  close(): void {
    this.socket.close()
  }
}

let server: RunningGameServer | null = null
const clients: TestClient[] = []
afterEach(async () => {
  clients.forEach((client) => client.close())
  clients.length = 0
  await server?.close()
  server = null
})

describe('live WebSocket rooms', () => {
  it('sends one ordered membership update for create and join', async () => {
    server = await createGameServer({ port: 0 })
    const host = await TestClient.connect(server.url)
    clients.push(host)
    host.send({ type: 'create-room', name: 'Host' })
    const createMessages = await host.take(3)
    expect(createMessages.map(({ type }) => type)).toEqual(['welcome', 'lobby', 'snapshot'])
    const welcome = createMessages[0] as Extract<ServerMessage, { type: 'welcome' }>

    const guest = await TestClient.connect(server.url)
    clients.push(guest)
    guest.send({ type: 'join-room', name: 'Guest', roomCode: welcome.roomCode })
    const [guestMessages, hostMessages] = await Promise.all([guest.take(3), host.take(2)])
    expect(guestMessages.map(({ type }) => type)).toEqual(['welcome', 'lobby', 'snapshot'])
    expect(hostMessages.map(({ type }) => type)).toEqual(['lobby', 'snapshot'])
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(host.takeAvailable()).toHaveLength(0)
    expect(guest.takeAvailable()).toHaveLength(0)
  })

  it('creates, joins, protects host start, snapshots, transfers host, and caps the room', async () => {
    let clockOffset = 0
    server = await createGameServer({ port: 0, now: () => performance.now() + clockOffset })
    for (let index = 0; index < 5; index += 1) clients.push(await TestClient.connect(server.url))
    const [host, second, third, fourth, fifth] = clients

    host.send({ type: 'create-room', name: 'Host' })
    const hostWelcome = await host.waitFor((message): message is Extract<ServerMessage, { type: 'welcome' }> => message.type === 'welcome')
    for (const [index, client] of [second, third, fourth].entries()) {
      client.send({ type: 'join-room', name: `Racer ${index + 2}`, roomCode: hostWelcome.roomCode })
      await client.waitFor((message): message is Extract<ServerMessage, { type: 'welcome' }> => message.type === 'welcome')
    }
    fifth.send({ type: 'join-room', name: 'Fifth', roomCode: hostWelcome.roomCode })
    const unavailable = await fifth.waitFor((message): message is Extract<ServerMessage, { type: 'error' }> => message.type === 'error')
    expect(unavailable.code).toBe('room-unavailable')

    second.send({ type: 'start-race' })
    const denied = await second.waitFor((message): message is Extract<ServerMessage, { type: 'error' }> => message.type === 'error' && message.code === 'start-denied')
    expect(denied.message).toContain('host')

    host.send({ type: 'start-race' })
    await host.waitFor((message): message is Extract<ServerMessage, { type: 'snapshot' }> => message.type === 'snapshot' && message.phase === 'countdown')
    clockOffset = 3_100
    const racing = await host.waitFor((message): message is Extract<ServerMessage, { type: 'snapshot' }> => message.type === 'snapshot' && message.phase === 'racing')
    expect(racing.karts).toHaveLength(4)
    const start = racing.karts.find((kart) => kart.id === hostWelcome.playerId)!
    host.send({ type: 'input', seq: 1, throttle: 1, steer: 0, brake: 0 })
    const moved = await host.waitFor((message): message is Extract<ServerMessage, { type: 'snapshot' }> => {
      if (message.type !== 'snapshot') return false
      const kart = message.karts.find((candidate) => candidate.id === hostWelcome.playerId)
      return Boolean(kart && Math.hypot(kart.x - start.x, kart.z - start.z) > 0.01)
    })
    expect(moved.karts.find((kart) => kart.id === hostWelcome.playerId)?.lastProcessedSeq).toBe(1)

    host.close()
    const transferred = await second.waitFor((message): message is Extract<ServerMessage, { type: 'lobby' }> => message.type === 'lobby' && message.hostId !== hostWelcome.playerId)
    expect(transferred.hostId).not.toBe(hostWelcome.playerId)
    expect(server.rooms.get(hostWelcome.roomCode)?.size).toBe(3)
  })

  it('disposes a room after its final racer disconnects', async () => {
    server = await createGameServer({ port: 0 })
    const client = await TestClient.connect(server.url)
    clients.push(client)
    client.send({ type: 'create-room', name: 'Solo' })
    const welcome = await client.waitFor((message): message is Extract<ServerMessage, { type: 'welcome' }> => message.type === 'welcome')
    expect(server.rooms.has(welcome.roomCode)).toBe(true)
    client.close()
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(server.rooms.has(welcome.roomCode)).toBe(false)
  })

  it('rejects starting with one player and stale input sequences', async () => {
    server = await createGameServer({ port: 0 })
    const client = await TestClient.connect(server.url)
    clients.push(client)
    client.send({ type: 'create-room', name: 'Solo' })
    await client.waitFor((message): message is Extract<ServerMessage, { type: 'welcome' }> => message.type === 'welcome')
    client.send({ type: 'start-race' })
    await client.waitFor((message): message is Extract<ServerMessage, { type: 'error' }> => message.type === 'error' && message.code === 'start-denied')
    client.send({ type: 'input', seq: 4, throttle: 1, steer: 0, brake: 0 })
    client.send({ type: 'input', seq: 4, throttle: 1, steer: 0, brake: 0 })
    const stale = await client.waitFor((message): message is Extract<ServerMessage, { type: 'error' }> => message.type === 'error' && message.code === 'input-rejected')
    expect(stale.message).toContain('sequence')
  })

  it('survives inherited protocol names and accepts the next valid action', async () => {
    server = await createGameServer({ port: 0 })
    const client = await TestClient.connect(server.url)
    clients.push(client)
    client.sendRaw(JSON.stringify({ type: 'constructor' }))
    const error = await client.waitFor((message): message is Extract<ServerMessage, { type: 'error' }> => message.type === 'error')
    expect(error.code).toBe('invalid-message')
    client.send({ type: 'create-room', name: 'Still Here' })
    await client.waitFor((message): message is Extract<ServerMessage, { type: 'welcome' }> => message.type === 'welcome')
  })

  it('returns 400 for a malformed upgrade target and remains healthy', async () => {
    server = await createGameServer({ port: 0 })
    const response = await new Promise<string>((resolve, reject) => {
      const socket = connectTcp(server!.port, '127.0.0.1')
      let data = ''
      const timer = setTimeout(() => {
        socket.destroy()
        reject(new Error('Timed out waiting for malformed upgrade response'))
      }, 2_000)
      socket.setEncoding('utf8')
      socket.on('connect', () => socket.write([
        'GET http://[ HTTP/1.1',
        'Host: localhost',
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Version: 13',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        '',
        '',
      ].join('\r\n')))
      socket.on('data', (chunk) => { data += chunk })
      socket.on('end', () => {
        clearTimeout(timer)
        resolve(data)
      })
      socket.on('error', reject)
    })
    expect(response).toContain('400 Bad Request')
    const healthy = await TestClient.connect(server.url)
    clients.push(healthy)
    healthy.send({ type: 'create-room', name: 'Healthy' })
    await healthy.waitFor((message): message is Extract<ServerMessage, { type: 'welcome' }> => message.type === 'welcome')
  })

  it('rejects connections above the configured global cap', async () => {
    server = await createGameServer({ port: 0, maxConnections: 1 })
    const first = await TestClient.connect(server.url)
    clients.push(first)
    await expect(TestClient.connect(server.url)).rejects.toThrow(/503/)
    first.send({ type: 'create-room', name: 'First' })
    await first.waitFor((message): message is Extract<ServerMessage, { type: 'welcome' }> => message.type === 'welcome')
  })
})
