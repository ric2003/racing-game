import type WebSocket from 'ws'
import {
  COUNTDOWN_MS,
  FIXED_DT,
  INPUT_IDLE_MS,
  MAX_CATCH_UP_STEPS,
  MAX_PLAYERS,
  SNAPSHOT_EVERY_TICKS,
} from '../src/shared/constants.js'
import { applyFinishPlaces, createRaceProgress, rankRace, updateRaceProgress, type RaceProgress } from '../src/shared/race.js'
import { NEUTRAL_CONTROLS, type Controls, type KartSnapshot, type RacePhase, type ServerMessage } from '../src/shared/protocol.js'
import { resolveKartCollisions, stepKart, type KartState } from '../src/shared/simulation.js'
import { START_GRID, nearestTrackPoint } from '../src/shared/track.js'
import { sendServerMessage } from './socket.js'

const COLORS = [0xff5d73, 0x57d9ff, 0xffd166, 0x9cff57]
const MAX_INPUT_QUEUE = 30
const INPUT_STEPS = 2

interface QueuedInput extends Controls {
  seq: number
  stepsRemaining: number
}

export interface RoomPlayer {
  id: string
  name: string
  color: number
  slot: number
  socket: WebSocket
  kart: KartState
  race: RaceProgress
  controls: Controls
  inputQueue: QueuedInput[]
  lastReceivedSeq: number
  lastProcessedSeq: number
  lastInputAt: number
  lastResetAt: number
  joinedAt: number
}

export class RaceRoom {
  readonly players = new Map<string, RoomPlayer>()
  phase: RacePhase = 'lobby'
  hostId = ''
  countdownEndsAt: number | null = null
  tickNumber = 0
  private lastTime: number
  private accumulator = 0
  private firstFinishAt: number | null = null

  constructor(
    readonly code: string,
    private readonly now: () => number,
    private readonly onEmpty: (code: string) => void,
  ) {
    this.lastTime = now()
  }

  get size(): number {
    return this.players.size
  }

  addPlayer(id: string, name: string, socket: WebSocket): RoomPlayer | null {
    if (this.phase !== 'lobby' || this.players.size >= MAX_PLAYERS) return null
    const usedSlots = new Set([...this.players.values()].map((player) => player.slot))
    const slot = START_GRID.findIndex((_, index) => !usedSlots.has(index))
    if (slot < 0) return null
    const grid = START_GRID[slot]
    const player: RoomPlayer = {
      id,
      name,
      color: COLORS[slot],
      slot,
      socket,
      kart: { id, x: grid.x, z: grid.z, heading: grid.heading, vx: 0, vz: 0 },
      race: createRaceProgress(),
      controls: { ...NEUTRAL_CONTROLS },
      inputQueue: [],
      lastReceivedSeq: -1,
      lastProcessedSeq: -1,
      lastInputAt: this.now(),
      lastResetAt: -Infinity,
      joinedAt: this.now(),
    }
    this.players.set(id, player)
    if (!this.hostId) this.hostId = id
    return player
  }

  removePlayer(id: string): void {
    this.players.delete(id)
    if (id === this.hostId) {
      this.hostId = [...this.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0]?.id ?? ''
    }
    if (this.players.size === 0) {
      this.onEmpty(this.code)
      return
    }
    this.broadcastLobby()
    this.broadcastSnapshot()
  }

  start(playerId: string): string | null {
    if (playerId !== this.hostId) return 'Only the host can start the race.'
    if (this.phase !== 'lobby') return 'The race has already started.'
    if (this.players.size < 2) return 'At least two racers are required.'
    this.phase = 'countdown'
    this.countdownEndsAt = this.now() + COUNTDOWN_MS
    this.broadcastLobby()
    this.broadcastSnapshot()
    return null
  }

  setInput(playerId: string, seq: number, controls: Controls, now: number): string | null {
    const player = this.players.get(playerId)
    if (!player) return 'Join a room before driving.'
    if (seq <= player.lastReceivedSeq || seq - player.lastReceivedSeq > 10_000) return 'Input sequence is stale or invalid.'
    if (player.inputQueue.length >= MAX_INPUT_QUEUE) return 'Input queue is full.'
    player.inputQueue.push({ ...controls, seq, stepsRemaining: INPUT_STEPS })
    player.lastReceivedSeq = seq
    player.lastInputAt = now
    return null
  }

  reset(playerId: string): string | null {
    const player = this.players.get(playerId)
    const now = this.now()
    if (!player || this.phase !== 'racing') return 'Reset is available during a race.'
    if (now - player.lastResetAt < 1_000) return 'Reset is cooling down.'
    const nearest = nearestTrackPoint(player.kart)
    player.kart.x = nearest.x
    player.kart.z = nearest.z
    player.kart.heading = Math.atan2(nearest.tangentX, nearest.tangentZ)
    player.kart.vx = 0
    player.kart.vz = 0
    player.controls = { ...NEUTRAL_CONTROLS }
    player.inputQueue = []
    player.lastProcessedSeq = player.lastReceivedSeq
    player.lastResetAt = now
    return null
  }

  advance(now: number): void {
    const elapsed = Math.min(0.1, Math.max(0, (now - this.lastTime) / 1_000))
    this.lastTime = now
    this.accumulator += elapsed
    let steps = 0
    while (this.accumulator >= FIXED_DT && steps < MAX_CATCH_UP_STEPS) {
      this.step(now)
      this.accumulator -= FIXED_DT
      steps += 1
    }
    if (steps === MAX_CATCH_UP_STEPS) this.accumulator = 0
  }

  private step(now: number): void {
    this.tickNumber += 1
    const previousPhase = this.phase
    if (this.phase === 'countdown' && this.countdownEndsAt !== null && now >= this.countdownEndsAt) this.phase = 'racing'
    if (this.phase === 'racing') {
      const players = [...this.players.values()]
      const previousPositions = new Map(players.map((player) => [player.id, { x: player.kart.x, z: player.kart.z }]))
      for (const player of players) {
        const queued = player.inputQueue[0]
        if (queued) {
          player.controls = { throttle: queued.throttle, steer: queued.steer, brake: queued.brake }
          queued.stepsRemaining -= 1
          if (queued.stepsRemaining === 0) {
            player.lastProcessedSeq = queued.seq
            player.inputQueue.shift()
          }
        } else if (now - player.lastInputAt > INPUT_IDLE_MS) {
          player.controls = { ...NEUTRAL_CONTROLS }
        }
        stepKart(player.kart, player.controls)
      }
      resolveKartCollisions(players.map((player) => player.kart))
      for (const player of players) {
        updateRaceProgress(player.race, previousPositions.get(player.id)!, player.kart, now)
        if (player.race.finishedAt !== null && this.firstFinishAt === null) this.firstFinishAt = now
      }
      applyFinishPlaces(players.map((player) => ({ ...player.race, id: player.id, name: player.name })))
      const finished = players.filter((player) => player.race.finishedAt !== null).sort((a, b) => (a.race.finishedAt ?? 0) - (b.race.finishedAt ?? 0))
      finished.forEach((player, index) => {
        player.race.finishPlace = index + 1
      })
      if (players.length > 0 && (finished.length === players.length || (this.firstFinishAt !== null && now - this.firstFinishAt > 20_000))) this.phase = 'finished'
    }
    const isActive = this.phase === 'countdown' || this.phase === 'racing'
    if (this.phase !== previousPhase || (isActive && this.tickNumber % SNAPSHOT_EVERY_TICKS === 0)) this.broadcastSnapshot()
  }

  broadcastLobby(): void {
    this.sendAll({
      type: 'lobby',
      roomCode: this.code,
      hostId: this.hostId,
      phase: this.phase,
      players: [...this.players.values()].map(({ id, name, color }) => ({ id, name, color })),
    })
  }

  broadcastSnapshot(): void {
    const entries = [...this.players.values()].map((player) => ({ ...player.race, id: player.id, name: player.name }))
    const standings = rankRace(entries).map((entry, index) => ({
      id: entry.id,
      name: entry.name,
      lap: entry.lap,
      place: index + 1,
      finished: entry.finishedAt !== null,
    }))
    const karts: KartSnapshot[] = [...this.players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      x: player.kart.x,
      z: player.kart.z,
      heading: player.kart.heading,
      vx: player.kart.vx,
      vz: player.kart.vz,
      lap: player.race.lap,
      nextCheckpoint: player.race.nextCheckpoint,
      finishedAt: player.race.finishedAt,
      finishPlace: player.race.finishPlace,
      lastProcessedSeq: player.lastProcessedSeq,
    }))
    this.sendAll({
      type: 'snapshot',
      tick: this.tickNumber,
      serverTime: this.now(),
      phase: this.phase,
      countdownEndsAt: this.countdownEndsAt,
      hostId: this.hostId,
      karts,
      standings,
    })
  }

  private sendAll(message: ServerMessage): void {
    for (const player of this.players.values()) sendServerMessage(player.socket, message)
  }
}
