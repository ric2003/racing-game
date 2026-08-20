/// <reference lib="dom" />
/// <reference types="vite/client" />

import { afterEach, describe, expect, it, vi } from 'vitest'
import { GameClient, type NetworkState } from '../../src/network/client.js'

class FakeWebSocket {
  static readonly OPEN = 1
  static instances: FakeWebSocket[] = []

  readyState = FakeWebSocket.OPEN
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  send = vi.fn()
  close = vi.fn()

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }

  open(): void {
    this.onopen?.({} as Event)
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent)
  }

  closeFromServer(): void {
    this.onclose?.({ code: 1000, reason: 'Race complete' } as CloseEvent)
  }
}

describe('game client connection lifecycle', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    FakeWebSocket.instances = []
  })

  it('does not report a clean close after a finished race as a connection error', () => {
    vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost:5173' } })
    vi.stubGlobal('localStorage', { getItem: vi.fn(), setItem: vi.fn() })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const client = new GameClient()
    const states: NetworkState[] = []
    client.subscribe((next) => { states.push(next) })

    client.createRoom('Alpha')
    const socket = FakeWebSocket.instances[0]
    socket.open()
    socket.receive({ type: 'snapshot', phase: 'finished' })
    socket.closeFromServer()

    expect(states.at(-1)?.status).toBe('disconnected')
    expect(states.at(-1)?.error).toBeNull()
  })
})
