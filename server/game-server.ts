import { createServer, type Server as HttpServer } from 'node:http'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { WebSocketServer, type RawData } from 'ws'
import { MAX_MESSAGE_BYTES } from '../src/shared/constants.js'
import type { ClientMessage, RaceSettings } from '../src/shared/protocol.js'
import { RaceRoom } from './room.js'
import { createPlayerId, createRoomCode } from './room-code.js'
import { sendServerMessage } from './socket.js'
import { serveStatic } from './static.js'
import { isAllowedOrigin, parseClientMessage } from './validation.js'

interface ConnectionContext {
  playerId: string
  room: RaceRoom | null
  reconnectToken: string | null
  strikes: number
  lobbyTimes: number[]
  inputTimes: number[]
}

export interface GameServerOptions {
  port?: number
  host?: string
  now?: () => number
  distDir?: string
  allowedOrigins?: string
  maxConnections?: number
}

export interface RunningGameServer {
  port: number
  url: string
  rooms: Map<string, RaceRoom>
  close: () => Promise<void>
}

function rawToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data
  if (Array.isArray(data)) return Buffer.concat(data)
  return Buffer.from(data)
}

function rateAllowed(times: number[], now: number, windowMs: number, limit: number): boolean {
  while (times.length > 0 && now - times[0] > windowMs) times.shift()
  if (times.length >= limit) return false
  times.push(now)
  return true
}

export async function createGameServer(options: GameServerOptions = {}): Promise<RunningGameServer> {
  const now = options.now ?? (() => performance.now())
  const rooms = new Map<string, RaceRoom>()
  const distDir = options.distDir ?? resolve(process.cwd(), 'dist')
  const requestedMaxConnections = options.maxConnections ?? 64
  const maxConnections = Number.isSafeInteger(requestedMaxConnections) && requestedMaxConnections > 0 ? requestedMaxConnections : 64
  const httpServer: HttpServer = createServer((request, response) => serveStatic(distDir, request, response))
  const socketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false })

  httpServer.on('upgrade', (request, socket, head) => {
    let pathname: string
    try {
      pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    } catch {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    if (pathname !== '/ws' || !isAllowedOrigin(request.headers.origin, options.allowedOrigins)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    if (socketServer.clients.size >= maxConnections) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nRetry-After: 5\r\n\r\n')
      socket.destroy()
      return
    }
    socketServer.handleUpgrade(request, socket, head, (webSocket) => socketServer.emit('connection', webSocket, request))
  })

  socketServer.on('connection', (socket) => {
    const context: ConnectionContext = {
      playerId: createPlayerId(),
      room: null,
      reconnectToken: null,
      strikes: 0,
      lobbyTimes: [],
      inputTimes: [],
    }

    const fail = (code: string, message: string, strike = true) => {
      sendServerMessage(socket, { type: 'error', code, message })
      if (strike) context.strikes += 1
      if (context.strikes >= 3) socket.close(1008, 'Too many invalid messages')
    }

    socket.on('message', (raw) => {
      const parsed = parseClientMessage(rawToBuffer(raw))
      if (!parsed.ok) {
        fail(parsed.code, parsed.message)
        return
      }
      const message: ClientMessage = parsed.message
      const time = now()
      const isInput = message.type === 'input'
      if (!rateAllowed(isInput ? context.inputTimes : context.lobbyTimes, time, isInput ? 1_000 : 10_000, isInput ? 40 : 5)) {
        fail('rate-limit', 'Too many messages. Slow down.')
        return
      }

      if (message.type === 'create-room') {
        if (context.room) {
          fail('already-joined', 'Leave the current room before creating another.', false)
          return
        }
        const code = createRoomCode(new Set(rooms.keys()))
        const room = new RaceRoom(code, now, (emptyCode) => rooms.delete(emptyCode))
        rooms.set(code, room)
        const player = room.addPlayer(context.playerId, message.name, socket)
        if (!player) {
          rooms.delete(code)
          fail('room-unavailable', 'That room is unavailable.', false)
          return
        }
        context.room = room
        context.reconnectToken = player.resumeToken
        sendServerMessage(socket, { type: 'welcome', playerId: context.playerId, roomCode: code, reconnectToken: player.resumeToken })
        room.broadcastLobby()
        room.broadcastSnapshot()
        return
      }

      if (message.type === 'join-room') {
        if (context.room) {
          fail('already-joined', 'Leave the current room before joining another.', false)
          return
        }
        const room = rooms.get(message.roomCode)
        const player = room?.addPlayer(context.playerId, message.name, socket)
        if (!room || !player) {
          fail('room-unavailable', 'That room is unavailable.', false)
          return
        }
        context.room = room
        context.reconnectToken = player.resumeToken
        sendServerMessage(socket, { type: 'welcome', playerId: context.playerId, roomCode: room.code, reconnectToken: player.resumeToken })
        room.broadcastLobby()
        room.broadcastSnapshot()
        return
      }

      if (message.type === 'resume-room') {
        if (context.room) {
          fail('already-joined', 'Leave the current room before resuming another.', false)
          return
        }
        const room = rooms.get(message.roomCode)
        const player = room?.resumePlayerByToken(message.name, message.token, socket)
        if (!room || !player) {
          fail('resume-unavailable', 'That reconnect window has expired.', false)
          return
        }
        context.playerId = player.id
        context.reconnectToken = player.resumeToken
        context.room = room
        sendServerMessage(socket, { type: 'welcome', playerId: player.id, roomCode: room.code, reconnectToken: player.resumeToken })
        room.broadcastLobby()
        room.broadcastSnapshot()
        return
      }

      if (!context.room) {
        fail('not-in-room', 'Create or join a room first.', false)
        return
      }
      if (message.type === 'start-race') {
        const error = context.room.start(context.playerId)
        if (error) fail('start-denied', error, false)
      } else if (message.type === 'update-race-settings') {
        const settings: RaceSettings = {
          trackId: message.trackId,
          laps: message.laps,
          itemsEnabled: message.itemsEnabled,
          mode: message.mode,
        }
        const error = context.room.updateSettings(context.playerId, settings)
        if (error) fail('settings-denied', error, false)
      } else if (message.type === 'cast-track-vote') {
        const error = context.room.castTrackVote(context.playerId, message.trackId)
        if (error) fail('vote-denied', error, false)
      } else if (message.type === 'request-rematch') {
        const error = context.room.requestRematch(context.playerId)
        if (error) fail('rematch-denied', error, false)
      } else if (message.type === 'quick-reaction') {
        const error = context.room.quickReaction(context.playerId, message.reaction)
        if (error) fail('reaction-denied', error, false)
      } else if (message.type === 'input') {
        const error = context.room.setInput(context.playerId, message.seq, {
          throttle: message.throttle,
          steer: message.steer,
          brake: message.brake,
          useItem: message.useItem,
        }, time)
        if (error) fail('input-rejected', error)
      } else if (message.type === 'reset') {
        const error = context.room.reset(context.playerId)
        if (error) fail('reset-denied', error, false)
      }
    })

    socket.on('close', () => context.room?.suspendPlayer(context.playerId))
    socket.on('error', () => undefined)
  })

  const interval = setInterval(() => {
    const time = now()
    for (const room of rooms.values()) room.advance(time)
  }, 8)
  interval.unref()

  await new Promise<void>((resolveListen, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(options.port ?? 3001, options.host ?? '127.0.0.1', () => {
      httpServer.off('error', reject)
      resolveListen()
    })
  })
  const address = httpServer.address()
  if (!address || typeof address === 'string') throw new Error('Server did not bind to a TCP port')

  return {
    port: address.port,
    url: `ws://127.0.0.1:${address.port}/ws`,
    rooms,
    close: async () => {
      clearInterval(interval)
      for (const client of socketServer.clients) client.close(1001, 'Server shutting down')
      await new Promise<void>((resolveClose) => socketServer.close(() => resolveClose()))
      await new Promise<void>((resolveClose, reject) => httpServer.close((error) => error ? reject(error) : resolveClose()))
    },
  }
}
