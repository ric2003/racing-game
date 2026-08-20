import { describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { RaceRoom } from '../../server/room.js'
import { MAX_SOCKET_BUFFER_BYTES, sendServerMessage } from '../../server/socket.js'
import { LocalPredictor } from '../../src/game/prediction.js'
import type { KartSnapshot, PendingInput } from '../../src/shared/protocol.js'
import { CHECKPOINTS, nearestTrackPoint, TRACK_POINTS } from '../../src/shared/track.js'

function closedSocket(): WebSocket {
  return { readyState: WebSocket.CLOSED } as WebSocket
}

function openSocket(messages: string[]): WebSocket {
  return {
    readyState: WebSocket.OPEN,
    bufferedAmount: 0,
    send: (data: string) => messages.push(data),
    terminate: vi.fn(),
  } as unknown as WebSocket
}

function createRoom() {
  let clock = 0
  const room = new RaceRoom('ABC234', () => clock, () => undefined)
  const advance = () => {
    clock += 17
    room.advance(clock)
  }
  return { room, advance, setClock: (value: number) => { clock = value } }
}

function placeForCollision(room: RaceRoom, checkpointIndex: number): void {
  const checkpoint = CHECKPOINTS[checkpointIndex]
  const [front, back] = [...room.players.values()]
  front.kart.x = checkpoint.x - checkpoint.normalX * 0.2
  front.kart.z = checkpoint.z - checkpoint.normalZ * 0.2
  back.kart.x = checkpoint.x - checkpoint.normalX
  back.kart.z = checkpoint.z - checkpoint.normalZ
  front.kart.vx = front.kart.vz = back.kart.vx = back.kart.vz = 0
  front.race.nextCheckpoint = checkpointIndex
}

describe('authoritative race room', () => {
  it('allows a solo lobby warm-up and resets the kart before the race', () => {
    const { room, advance } = createRoom()
    const host = room.addPlayer('a', 'Alpha', closedSocket())!
    const start = { ...host.kart }

    expect(room.setInput(host.id, 1, { throttle: 1, steer: 0, brake: 0 }, 0)).toBeNull()
    advance()
    advance()

    expect(room.phase).toBe('lobby')
    expect(host.lastProcessedSeq).toBe(1)
    expect(Math.hypot(host.kart.x - start.x, host.kart.z - start.z)).toBeGreaterThan(0.001)
    expect(host.race.lap).toBe(0)

    room.addPlayer('b', 'Bravo', closedSocket())
    expect(room.start(host.id)).toBeNull()
    expect(host.kart.x).toBe(start.x)
    expect(host.kart.z).toBe(start.z)
    expect(host.kart.vx).toBe(0)
    expect(host.kart.vz).toBe(0)
    expect(host.lastProcessedSeq).toBe(host.lastReceivedSeq)
  })

  it('consumes queued inputs for two steps and acknowledges only completed samples', () => {
    const { room, advance } = createRoom()
    const player = room.addPlayer('a', 'Alpha', closedSocket())!
    room.phase = 'racing'
    expect(room.setInput('a', 1, { throttle: 1, steer: 0, brake: 0 }, 0)).toBeNull()
    expect(room.setInput('a', 2, { throttle: -1, steer: 0, brake: 0 }, 0)).toBeNull()

    advance()
    expect(player.lastProcessedSeq).toBe(-1)
    advance()
    expect(player.lastProcessedSeq).toBe(1)
    const forwardSpeed = player.kart.vx * Math.sin(player.kart.heading) + player.kart.vz * Math.cos(player.kart.heading)
    expect(forwardSpeed).toBeGreaterThan(0)
    advance()
    expect(player.lastProcessedSeq).toBe(1)
    advance()
    expect(player.lastProcessedSeq).toBe(2)
    const slowedSpeed = player.kart.vx * Math.sin(player.kart.heading) + player.kart.vz * Math.cos(player.kart.heading)
    expect(slowedSpeed).toBeLessThan(forwardSpeed)
  })

  it('resolves discarded input acknowledgments when resetting', () => {
    const { room, advance } = createRoom()
    const player = room.addPlayer('a', 'Alpha', closedSocket())!
    room.phase = 'racing'
    const pending: PendingInput[] = [
      { seq: 1, throttle: 1, steer: 0, brake: 0 },
      { seq: 2, throttle: 1, steer: 0.5, brake: 0 },
    ]
    for (const input of pending) room.setInput('a', input.seq, input, 0)
    advance()

    expect(room.reset('a')).toBeNull()
    expect(player.inputQueue).toHaveLength(0)
    expect(player.lastProcessedSeq).toBe(player.lastReceivedSeq)

    const snapshot: KartSnapshot = {
      name: player.name,
      color: player.color,
      ...player.kart,
      lap: player.race.lap,
      nextCheckpoint: player.race.nextCheckpoint,
      finishedAt: player.race.finishedAt,
      finishPlace: player.race.finishPlace,
      lastProcessedSeq: player.lastProcessedSeq,
    }
    const predictor = new LocalPredictor()
    predictor.reconcile(snapshot, pending.filter((input) => input.seq > snapshot.lastProcessedSeq))
    expect(predictor.state).toEqual(player.kart)
  })

  it.each([64, 104])('resets cleanly beside technical curve sample %s', (trackIndex) => {
    const { room } = createRoom()
    const player = room.addPlayer('a', 'Alpha', closedSocket())!
    room.phase = 'racing'
    const point = TRACK_POINTS[trackIndex]
    const next = TRACK_POINTS[(trackIndex + 1) % TRACK_POINTS.length]
    const length = Math.hypot(next.x - point.x, next.z - point.z)
    const sideX = (next.z - point.z) / length
    const sideZ = -(next.x - point.x) / length
    player.kart.x = point.x + sideX * 12
    player.kart.z = point.z + sideZ * 12
    player.kart.vx = 15
    player.kart.vz = -4
    const expected = nearestTrackPoint(player.kart)

    expect(room.reset(player.id)).toBeNull()
    expect(player.kart.x).toBeCloseTo(expected.x)
    expect(player.kart.z).toBeCloseTo(expected.z)
    expect(player.kart.heading).toBeCloseTo(Math.atan2(expected.tangentX, expected.tangentZ))
    expect(player.kart.vx).toBe(0)
    expect(player.kart.vz).toBe(0)
  })

  it('counts collision-driven checkpoint and finish crossings after separation', () => {
    const checkpointRoom = createRoom()
    checkpointRoom.room.addPlayer('a', 'Alpha', closedSocket())
    checkpointRoom.room.addPlayer('b', 'Bravo', closedSocket())
    checkpointRoom.room.phase = 'racing'
    placeForCollision(checkpointRoom.room, 1)
    checkpointRoom.advance()
    expect(checkpointRoom.room.players.get('a')?.race.nextCheckpoint).toBe(2)

    const finishRoom = createRoom()
    finishRoom.room.addPlayer('a', 'Alpha', closedSocket())
    finishRoom.room.addPlayer('b', 'Bravo', closedSocket())
    finishRoom.room.phase = 'racing'
    const finisher = finishRoom.room.players.get('a')!
    finisher.race.lap = 2
    finisher.race.nextCheckpoint = 0
    placeForCollision(finishRoom.room, 0)
    finishRoom.advance()
    expect(finisher.race.lap).toBe(3)
    expect(finisher.race.finishedAt).not.toBeNull()
  })

  it('reuses the first free lobby slot without duplicating spawn or color', () => {
    const { room } = createRoom()
    for (const id of ['a', 'b', 'c', 'd']) room.addPlayer(id, id.repeat(2), closedSocket())
    room.removePlayer('b')
    const replacement = room.addPlayer('e', 'Echo', closedSocket())!
    const players = [...room.players.values()]
    expect(replacement.slot).toBe(1)
    expect(new Set(players.map(({ slot }) => slot)).size).toBe(4)
    expect(new Set(players.map(({ color }) => color)).size).toBe(4)
    const spawnKeys = players.map(({ kart }) => `${kart.x}:${kart.z}`)
    expect(new Set(spawnKeys).size).toBe(4)
  })

  it('does not broadcast periodic snapshots while lobby or finished is idle', () => {
    const messages: string[] = []
    const { room, advance } = createRoom()
    room.addPlayer('a', 'Alpha', openSocket(messages))
    messages.length = 0
    for (let index = 0; index < 12; index += 1) advance()
    expect(messages).toHaveLength(0)
    room.phase = 'finished'
    for (let index = 0; index < 12; index += 1) advance()
    expect(messages).toHaveLength(0)
  })

  it('terminates a peer whose outbound queue exceeds the backpressure ceiling', () => {
    const socket = {
      readyState: WebSocket.OPEN,
      bufferedAmount: MAX_SOCKET_BUFFER_BYTES + 1,
      send: vi.fn(),
      terminate: vi.fn(),
    } as unknown as WebSocket
    expect(sendServerMessage(socket, { type: 'error', code: 'test', message: 'test' })).toBe(false)
    expect(socket.terminate).toHaveBeenCalledOnce()
    expect(socket.send).not.toHaveBeenCalled()
  })

  it('supports host settings, track votes, rematches, and deterministic item pickup', () => {
    const { room, advance } = createRoom()
    const host = room.addPlayer('a', 'Alpha', closedSocket())!
    room.addPlayer('b', 'Bravo', closedSocket())
    room.addPlayer('c', 'Charlie', closedSocket())
    expect(room.updateSettings(host.id, { trackId: 'neon-harbor', laps: 2, itemsEnabled: true, mode: 'standard' })).toBeNull()
    expect(room.castTrackVote('b', 'neon-harbor')).toBeNull()
    expect(room.castTrackVote('c', 'neon-harbor')).toBeNull()
    expect(room.start(host.id)).toBeNull()
    expect(room.settings.trackId).toBe('neon-harbor')
    room.phase = 'racing'
    const box = room.itemBoxSnapshots[0]
    host.kart.x = box.x
    host.kart.z = box.z
    advance()
    expect(host.item.heldItem).not.toBeNull()
    host.item.heldItem = 'shield'
    expect(room.setInput(host.id, 1, { throttle: 0, steer: 0, brake: 0, useItem: true }, 17)).toBeNull()
    advance()
    expect(host.item.heldItem).toBeNull()
    expect(host.item.shieldedUntil).not.toBeNull()
    room.phase = 'finished'
    expect(room.requestRematch(host.id)).toBeNull()
    expect(room.phase).toBe('lobby')
    expect(host.race.lap).toBe(0)
  })

  it('reclaims a disconnected racer using its short-lived resume token', () => {
    const { room } = createRoom()
    const player = room.addPlayer('a', 'Alpha', closedSocket())!
    const token = player.resumeToken
    room.addPlayer('b', 'Bravo', closedSocket())
    room.suspendPlayer(player.id)
    expect(room.players.has(player.id)).toBe(false)
    const resumed = room.resumePlayerByToken('Alpha', token, closedSocket())
    expect(resumed?.id).toBe(player.id)
    expect(room.players.has(player.id)).toBe(true)
  })
})
