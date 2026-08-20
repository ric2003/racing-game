import type { ClientMessage, Controls, PendingInput, QuickReaction, RaceSettings, ServerMessage } from '../shared/protocol.js'

export type { PendingInput } from '../shared/protocol.js'

export interface NetworkState {
  status: 'idle' | 'connecting' | 'connected' | 'disconnected'
  playerId: string | null
  roomCode: string | null
  lobby: Extract<ServerMessage, { type: 'lobby' }> | null
  snapshot: Extract<ServerMessage, { type: 'snapshot' }> | null
  reconnectToken: string | null
  reaction: Extract<ServerMessage, { type: 'reaction' }> | null
  error: string | null
}

const initialState: NetworkState = {
  status: 'idle',
  playerId: null,
  roomCode: null,
  lobby: null,
  snapshot: null,
  reconnectToken: null,
  reaction: null,
  error: null,
}

export class GameClient {
  private socket: WebSocket | null = null
  private listeners = new Set<(state: NetworkState) => void>()
  private state: NetworkState = { ...initialState }
  private sequence = 0
  private pending: PendingInput[] = []

  subscribe(listener: (state: NetworkState) => void): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  createRoom(name: string): void {
    this.connect({ type: 'create-room', name })
  }

  joinRoom(name: string, roomCode: string): void {
    this.connect({ type: 'join-room', name, roomCode })
  }

  resumeRoom(name: string, roomCode: string, token?: string): void {
    const reconnectToken = token ?? this.reconnectTokenFor(roomCode)
    if (!reconnectToken) return
    this.connect({ type: 'resume-room', name, roomCode, token: reconnectToken })
  }

  startRace(): void {
    this.send({ type: 'start-race' })
  }

  resetKart(): void {
    this.send({ type: 'reset' })
  }

  updateRaceSettings(settings: RaceSettings): void {
    this.send({ type: 'update-race-settings', ...settings })
  }

  voteTrack(trackId: string): void {
    this.send({ type: 'cast-track-vote', trackId })
  }

  requestRematch(): void {
    this.send({ type: 'request-rematch' })
  }

  sendReaction(reaction: QuickReaction): void {
    this.send({ type: 'quick-reaction', reaction })
  }

  sendInput(controls: Controls): PendingInput {
    const input: PendingInput = { ...controls, seq: this.sequence += 1 }
    this.pending.push(input)
    if (this.pending.length > 120) this.pending.shift()
    this.send({ type: 'input', ...input })
    return input
  }

  pendingAfter(sequence: number): PendingInput[] {
    this.pending = this.pending.filter((input) => input.seq > sequence)
    return [...this.pending]
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.onclose = null
      this.socket.close(1000, 'Leaving room')
      this.socket = null
    }
    this.sequence = 0
    this.pending = []
    this.setState({ ...initialState })
  }

  private connect(action: ClientMessage): void {
    this.disconnect()
    const configured = import.meta.env.VITE_WS_URL as string | undefined
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const endpoint = configured || `${protocol}//${window.location.host}/ws`
    const socket = new WebSocket(endpoint)
    this.socket = socket
    this.setState({ ...initialState, status: 'connecting' })
    socket.onopen = () => {
      if (socket !== this.socket) return
      this.setState({ ...this.state, status: 'connected', error: null })
      this.send(action)
    }
    socket.onmessage = (event) => {
      if (socket !== this.socket || typeof event.data !== 'string') return
      let message: ServerMessage
      try {
        message = JSON.parse(event.data) as ServerMessage
      } catch {
        return
      }
      if (message.type === 'welcome') {
        localStorage.setItem(this.tokenKey(message.roomCode), message.reconnectToken)
        this.setState({ ...this.state, playerId: message.playerId, roomCode: message.roomCode, reconnectToken: message.reconnectToken })
      } else if (message.type === 'lobby') {
        this.setState({ ...this.state, lobby: message, roomCode: message.roomCode })
      } else if (message.type === 'snapshot') {
        this.setState({ ...this.state, snapshot: message })
      } else if (message.type === 'error') {
        this.setState({ ...this.state, error: message.message })
      } else if (message.type === 'reaction') {
        this.setState({ ...this.state, reaction: message })
      }
    }
    socket.onerror = () => this.setState({ ...this.state, error: 'Could not reach the race server.' })
    socket.onclose = () => {
      if (socket !== this.socket) return
      this.socket = null
      const raceFinished = this.state.snapshot?.phase === 'finished'
      this.setState({
        ...this.state,
        status: 'disconnected',
        error: raceFinished ? null : this.state.error ?? 'Connection closed. Return to the lobby to race again.',
      })
    }
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message))
  }

  private tokenKey(roomCode: string): string {
    return `neon-apex-reconnect:${roomCode}`
  }

  private reconnectTokenFor(roomCode: string): string | null {
    try {
      return localStorage.getItem(this.tokenKey(roomCode))
    } catch {
      return null
    }
  }

  private setState(state: NetworkState): void {
    this.state = state
    for (const listener of this.listeners) listener(state)
  }
}
