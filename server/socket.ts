import WebSocket from 'ws'
import type { ServerMessage } from '../src/shared/protocol.js'

export const MAX_SOCKET_BUFFER_BYTES = 64 * 1_024

export function sendServerMessage(socket: WebSocket, message: ServerMessage): boolean {
  if (socket.readyState !== WebSocket.OPEN) return false
  if (socket.bufferedAmount > MAX_SOCKET_BUFFER_BYTES) {
    socket.terminate()
    return false
  }
  socket.send(JSON.stringify(message))
  return true
}
