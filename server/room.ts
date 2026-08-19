import { randomBytes } from 'node:crypto'
import type WebSocket from 'ws'
import {
  BOOST_DURATION_MS,
  COUNTDOWN_MS,
  DEFAULT_RACE_SETTINGS,
  FIXED_DT,
  INPUT_IDLE_MS,
  ITEM_BOX_RESPAWN_MS,
  MAX_CATCH_UP_STEPS,
  MAX_EVENTS_PER_SNAPSHOT,
  MAX_PLAYERS,
  OIL_DURATION_MS,
  RESUME_WINDOW_MS,
  SHIELD_DURATION_MS,
  SNAPSHOT_EVERY_TICKS,
  SPIN_DURATION_MS,
  SPIN_IMMUNITY_MS,
} from '../src/shared/constants.js'
import { applyFinishPlaces, beginRaceTiming, createRaceProgress, rankRace, updateRaceProgress, type RaceProgress } from '../src/shared/race.js'
import {
  DEFAULT_TRACK,
  getTrack,
  nearestTrackPoint,
  TRACKS,
  type HazardDefinition,
  type TrackDefinition,
} from '../src/shared/track.js'
import {
  NEUTRAL_CONTROLS,
  type Controls,
  type ItemBoxSnapshot,
  type ItemState,
  type ItemType,
  type KartSnapshot,
  type RaceEvent,
  type RacePhase,
  type RaceSettings,
  type RaceStats,
  type ServerMessage,
} from '../src/shared/protocol.js'
import { resolveKartCollisions, stepKart, type KartState } from '../src/shared/simulation.js'
import { sendServerMessage } from './socket.js'

const COLORS = [0xff5d73, 0x57d9ff, 0xffd166, 0x9cff57]
const MAX_INPUT_QUEUE = 30
const INPUT_STEPS = 2

interface QueuedInput extends Controls {
  seq: number
  stepsRemaining: number
}

interface OilSlick {
  id: number
  ownerId: string
  x: number
  z: number
  expiresAt: number
}

interface DetachedPlayer {
  player: RoomPlayer
  token: string
  expiresAt: number
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
  resumeToken: string
  item: ItemState
  boostUntil: number
  stats: RaceStats
  lastStandingPlace: number
}

function createResumeToken(): string {
  return randomBytes(18).toString('base64url')
}

function createStats(): RaceStats {
  return { overtakes: 0, itemHits: 0, itemsCollected: 0, spins: 0 }
}

function createItemState(): ItemState {
  return { heldItem: null, shieldedUntil: null, immuneUntil: null, disabledUntil: null }
}

function copySettings(settings: RaceSettings): RaceSettings {
  return { ...settings }
}

function distanceSquared(left: { x: number; z: number }, right: { x: number; z: number }): number {
  const dx = left.x - right.x
  const dz = left.z - right.z
  return dx * dx + dz * dz
}

function stableNumber(value: string): number {
  let hash = 2_166_136_261
  for (const character of value) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}

export class RaceRoom {
  readonly players = new Map<string, RoomPlayer>()
  readonly settings: RaceSettings = copySettings(DEFAULT_RACE_SETTINGS)
  readonly votes = new Map<string, string>()
  phase: RacePhase = 'lobby'
  hostId = ''
  countdownEndsAt: number | null = null
  tickNumber = 0
  private lastTime: number
  private accumulator = 0
  private firstFinishAt: number | null = null
  private readonly detached = new Map<string, DetachedPlayer>()
  private itemBoxes: ItemBoxSnapshot[] = []
  private oilSlicks: OilSlick[] = []
  private hazardCooldowns = new Map<string, number>()
  private events: RaceEvent[] = []
  private eventId = 0
  private oilId = 0
  private lastKnockoutThreshold = 0
  private track: TrackDefinition = DEFAULT_TRACK

  constructor(
    readonly code: string,
    private readonly now: () => number,
    private readonly onEmpty: (code: string) => void,
  ) {
    this.lastTime = now()
    this.resetItems()
  }

  get size(): number {
    return this.players.size
  }

  get trackOptions(): Array<{ id: string; name: string }> {
    return TRACKS.map(({ id, name }) => ({ id, name }))
  }

  get itemBoxSnapshots(): ItemBoxSnapshot[] {
    return this.itemBoxes.map((box) => ({ ...box }))
  }

  addPlayer(id: string, name: string, socket: WebSocket, resumeToken = createResumeToken()): RoomPlayer | null {
    if (this.phase !== 'lobby' || this.players.size + this.detached.size >= MAX_PLAYERS) return null
    const usedSlots = new Set([...this.players.values()].map((player) => player.slot))
    const slot = this.track.startGrid.findIndex((_, index) => !usedSlots.has(index))
    if (slot < 0) return null
    const player = this.createPlayer(id, name, socket, slot, resumeToken)
    this.players.set(id, player)
    if (!this.hostId) this.hostId = id
    return player
  }

  resumePlayer(id: string, name: string, token: string, socket: WebSocket): RoomPlayer | null {
    const detached = this.detached.get(id)
    if (!detached || detached.token !== token || detached.expiresAt < this.now()) {
      if (detached) this.detached.delete(id)
      return null
    }
    if (this.players.size >= MAX_PLAYERS) return null
    const player = detached.player
    player.socket = socket
    player.name = name.trim() || player.name
    player.lastInputAt = this.now()
    this.players.set(id, player)
    this.detached.delete(id)
    this.broadcastLobby()
    this.broadcastSnapshot()
    return player
  }

  resumePlayerByToken(name: string, token: string, socket: WebSocket): RoomPlayer | null {
    for (const [id, detached] of this.detached) {
      if (detached.token !== token) continue
      return this.resumePlayer(id, name, token, socket)
    }
    return null
  }

  suspendPlayer(id: string): void {
    const player = this.players.get(id)
    if (!player) return
    this.detached.set(id, { player, token: player.resumeToken, expiresAt: this.now() + RESUME_WINDOW_MS })
    this.removePlayer(id)
  }

  removePlayer(id: string): void {
    this.players.delete(id)
    this.votes.delete(id)
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

  updateSettings(playerId: string, settings: RaceSettings): string | null {
    if (playerId !== this.hostId) return 'Only the host can change race settings.'
    if (this.phase !== 'lobby') return 'Race settings can only change in the lobby.'
    if (!TRACKS.some((track) => track.id === settings.trackId)) return 'That track is unavailable.'
    if (![2, 3, 5].includes(settings.laps) || !['standard', 'knockout'].includes(settings.mode)) return 'Race settings are invalid.'
    if (settings.mode === 'knockout' && this.players.size < 3) return 'Knockout needs at least three racers.'
    Object.assign(this.settings, copySettings(settings))
    this.track = getTrack(settings.trackId)
    this.resetItems()
    this.broadcastLobby()
    return null
  }

  castTrackVote(playerId: string, trackId: string): string | null {
    if (!this.players.has(playerId)) return 'Join a room before voting.'
    if (this.phase !== 'lobby') return 'Track voting is closed.'
    if (!TRACKS.some((track) => track.id === trackId)) return 'That track is unavailable.'
    this.votes.set(playerId, trackId)
    this.broadcastLobby()
    return null
  }

  start(playerId: string): string | null {
    if (playerId !== this.hostId) return 'Only the host can start the race.'
    if (this.phase !== 'lobby') return 'The race has already started.'
    if (this.players.size < 2) return 'At least two racers are required.'
    if (this.settings.mode === 'knockout' && this.players.size < 3) return 'Knockout needs at least three racers.'
    this.selectVotedTrack()
    this.resetRaceState()
    this.phase = 'countdown'
    this.countdownEndsAt = this.now() + COUNTDOWN_MS
    this.broadcastLobby()
    this.broadcastSnapshot()
    return null
  }

  requestRematch(playerId: string): string | null {
    if (playerId !== this.hostId) return 'Only the host can request a rematch.'
    if (this.phase !== 'finished') return 'A rematch is available after the race.'
    this.resetRaceState()
    this.votes.clear()
    this.phase = 'lobby'
    this.countdownEndsAt = null
    this.firstFinishAt = null
    this.broadcastLobby()
    this.broadcastSnapshot()
    return null
  }

  quickReaction(playerId: string, reaction: 'nice' | 'oops' | 'rematch'): string | null {
    const player = this.players.get(playerId)
    if (!player) return 'Join a room before reacting.'
    this.sendAll({ type: 'reaction', playerId, name: player.name, reaction, at: this.now() })
    return null
  }

  setInput(playerId: string, seq: number, controls: Controls, now: number): string | null {
    const player = this.players.get(playerId)
    if (!player) return 'Join a room before driving.'
    if (seq <= player.lastReceivedSeq || seq - player.lastReceivedSeq > 10_000) return 'Input sequence is stale or invalid.'
    if (this.phase !== 'racing') {
      player.lastReceivedSeq = seq
      return null
    }
    if (player.inputQueue.length >= MAX_INPUT_QUEUE) return 'Input queue is full.'
    player.inputQueue.push({ ...controls, useItem: controls.useItem === true, seq, stepsRemaining: INPUT_STEPS })
    player.lastReceivedSeq = seq
    player.lastInputAt = now
    return null
  }

  reset(playerId: string): string | null {
    const player = this.players.get(playerId)
    const now = this.now()
    if (!player || this.phase !== 'racing') return 'Reset is available during a race.'
    if (now - player.lastResetAt < 1_000) return 'Reset is cooling down.'
    const nearest = nearestTrackPoint(player.kart, this.track)
    player.kart.x = nearest.x
    player.kart.z = nearest.z
    player.kart.heading = Math.atan2(nearest.tangentX, nearest.tangentZ)
    player.kart.vx = 0
    player.kart.vz = 0
    player.controls = { ...NEUTRAL_CONTROLS }
    player.inputQueue = []
    player.lastProcessedSeq = player.lastReceivedSeq
    player.item.disabledUntil = null
    player.lastResetAt = now
    return null
  }

  advance(now: number): void {
    this.purgeDetached(now)
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

  private createPlayer(id: string, name: string, socket: WebSocket, slot: number, resumeToken: string): RoomPlayer {
    const grid = this.track.startGrid[slot]
    return {
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
      resumeToken,
      item: createItemState(),
      boostUntil: 0,
      stats: createStats(),
      lastStandingPlace: slot + 1,
    }
  }

  private selectVotedTrack(): void {
    const counts = new Map<string, number>()
    for (const trackId of this.votes.values()) counts.set(trackId, (counts.get(trackId) ?? 0) + 1)
    let winner = this.settings.trackId
    let best = 0
    for (const track of TRACKS) {
      const count = counts.get(track.id) ?? 0
      const hostVote = this.votes.get(this.hostId) === track.id
      if (count > best || (count === best && hostVote)) {
        winner = track.id
        best = count
      }
    }
    this.settings.trackId = winner
    this.track = getTrack(winner)
  }

  private resetRaceState(): void {
    this.track = getTrack(this.settings.trackId)
    this.resetItems()
    for (const player of this.players.values()) {
      const grid = this.track.startGrid[player.slot]
      player.kart = { id: player.id, x: grid.x, z: grid.z, heading: grid.heading, vx: 0, vz: 0 }
      player.race = createRaceProgress()
      player.controls = { ...NEUTRAL_CONTROLS }
      player.inputQueue = []
      player.lastReceivedSeq = -1
      player.lastProcessedSeq = -1
      player.lastInputAt = this.now()
      player.lastResetAt = -Infinity
      player.item = createItemState()
      player.boostUntil = 0
      player.stats = createStats()
      player.lastStandingPlace = player.slot + 1
    }
    this.events = []
    this.eventId = 0
    this.oilId = 0
    this.lastKnockoutThreshold = 0
    this.hazardCooldowns.clear()
  }

  private resetItems(): void {
    this.itemBoxes = this.track.itemBoxes.map((point, id) => ({ id, x: point.x, z: point.z, availableAt: 0 }))
    this.oilSlicks = []
  }

  private step(now: number): void {
    this.tickNumber += 1
    const previousPhase = this.phase
    if (this.phase === 'countdown' && this.countdownEndsAt !== null && now >= this.countdownEndsAt) {
      this.phase = 'racing'
      for (const player of this.players.values()) beginRaceTiming(player.race, now)
    }
    if (this.phase === 'racing') this.stepRace(now)
    const isActive = this.phase === 'countdown' || this.phase === 'racing'
    if (this.phase !== previousPhase || (isActive && this.tickNumber % SNAPSHOT_EVERY_TICKS === 0)) this.broadcastSnapshot()
  }

  private stepRace(now: number): void {
    const players = [...this.players.values()]
    const activePlayers = players.filter((player) => !player.race.eliminated && player.race.finishedAt === null)
    const previousPositions = new Map(players.map((player) => [player.id, { x: player.kart.x, z: player.kart.z }]))
    const beforeOrder = rankRace(players.map((player) => ({ ...player.race, id: player.id, name: player.name })), this.track).map(({ id }) => id)

    for (const player of activePlayers) {
      const queued = player.inputQueue[0]
      if (queued) {
        player.controls = { throttle: queued.throttle, steer: queued.steer, brake: queued.brake }
        if (queued.useItem && queued.stepsRemaining === INPUT_STEPS) this.useItem(player, now)
        queued.stepsRemaining -= 1
        if (queued.stepsRemaining === 0) {
          player.lastProcessedSeq = queued.seq
          player.inputQueue.shift()
        }
      } else if (now - player.lastInputAt > INPUT_IDLE_MS) {
        player.controls = { ...NEUTRAL_CONTROLS }
      }
      const disabled = player.item.disabledUntil !== null && player.item.disabledUntil > now
      const turbo = player.boostUntil > now
      stepKart(player.kart, disabled ? NEUTRAL_CONTROLS : player.controls, FIXED_DT, turbo ? { accelerationMultiplier: 1.3, maxSpeedMultiplier: 1.15 } : undefined)
    }

    resolveKartCollisions(activePlayers.map((player) => player.kart), this.track)
    this.processHazards(activePlayers, now)
    this.processOilSlicks(activePlayers, now)
    if (this.settings.itemsEnabled) this.processItemBoxes(activePlayers, now)

    for (const player of activePlayers) {
      updateRaceProgress(player.race, previousPositions.get(player.id)!, player.kart, now, this.track, this.settings.laps)
      if (player.race.finishedAt !== null && this.firstFinishAt === null) this.firstFinishAt = now
    }

    this.applyKnockout(activePlayers, now)
    const afterEntries = players.map((player) => ({ ...player.race, id: player.id, name: player.name }))
    applyFinishPlaces(afterEntries)
    for (const entry of afterEntries) this.players.get(entry.id)!.race.finishPlace = entry.finishPlace
    const afterOrder = rankRace(afterEntries, this.track).map(({ id }) => id)
    for (const player of players) {
      const before = beforeOrder.indexOf(player.id)
      const after = afterOrder.indexOf(player.id)
      if (before > after && before >= 0 && after >= 0) {
        player.stats.overtakes += 1
        this.emit({ kind: 'overtake', playerId: player.id, at: now })
      }
      player.lastStandingPlace = after + 1
    }

    const finished = players.filter((player) => player.race.finishedAt !== null || player.race.eliminated)
    const remaining = players.filter((player) => !player.race.eliminated && player.race.finishedAt === null)
    if (this.settings.mode === 'knockout' && remaining.length <= 1) {
      const winner = remaining[0]
      if (winner) {
        winner.race.finishedAt = now
        winner.race.finishPlace = 1
      }
      this.phase = 'finished'
    } else if (players.length > 0 && (finished.length === players.length || (this.firstFinishAt !== null && now - this.firstFinishAt > 20_000))) {
      this.phase = 'finished'
    }
  }

  private applyKnockout(players: RoomPlayer[], now: number): void {
    if (this.settings.mode !== 'knockout') return
    const checkpointTotal = this.track.checkpoints.length
    const threshold = 4
    const completed = Math.max(...players.map((player) => player.race.lap * checkpointTotal + (player.race.nextCheckpoint === 0 ? checkpointTotal : player.race.nextCheckpoint - 1)), 0)
    const thresholdNumber = Math.floor(completed / threshold)
    if (completed < threshold || thresholdNumber <= this.lastKnockoutThreshold) return
    const candidates = players.filter((player) => !player.race.eliminated && player.race.finishedAt === null)
    if (candidates.length <= 1) return
    const last = rankRace(candidates.map((player) => ({ ...player.race, id: player.id, name: player.name })), this.track).at(-1)
    if (!last) return
    this.lastKnockoutThreshold = thresholdNumber
    const player = this.players.get(last.id)!
    player.race.eliminated = true
    player.race.eliminatedAt = now
    player.item = createItemState()
    this.emit({ kind: 'eliminated', playerId: player.id, at: now })
  }

  private processItemBoxes(players: RoomPlayer[], now: number): void {
    for (const box of this.itemBoxes) {
      if (box.availableAt > now) continue
      const player = players.find((candidate) => candidate.item.heldItem === null && distanceSquared(candidate.kart, box) < 3.2 * 3.2)
      if (!player) continue
      player.item.heldItem = this.chooseItem(player)
      player.stats.itemsCollected += 1
      box.availableAt = now + ITEM_BOX_RESPAWN_MS
      this.emit({ kind: 'item-pickup', playerId: player.id, item: player.item.heldItem, at: now })
    }
  }

  private chooseItem(player: RoomPlayer): ItemType {
    const place = Math.max(1, player.lastStandingPlace)
    const roll = (stableNumber(`${this.code}:${this.tickNumber}:${player.id}`) % 100)
    if (place === 1) return roll < 60 ? 'shield' : 'oil-slick'
    if (place === 2) return roll < 30 ? 'turbo' : roll < 55 ? 'shield' : roll < 80 ? 'pulse-bolt' : 'oil-slick'
    return roll < 45 ? 'turbo' : roll < 75 ? 'pulse-bolt' : roll < 88 ? 'shield' : 'oil-slick'
  }

  private useItem(player: RoomPlayer, now: number): void {
    const item = player.item.heldItem
    if (!item || player.race.eliminated) return
    player.item.heldItem = null
    this.emit({ kind: 'item-used', playerId: player.id, item, at: now })
    if (item === 'turbo') {
      player.boostUntil = Math.max(player.boostUntil, now + BOOST_DURATION_MS)
      this.emit({ kind: 'boost', playerId: player.id, item, at: now })
      return
    }
    if (item === 'shield') {
      player.item.shieldedUntil = now + SHIELD_DURATION_MS
      return
    }
    if (item === 'oil-slick') {
      const forwardX = Math.sin(player.kart.heading)
      const forwardZ = Math.cos(player.kart.heading)
      this.oilSlicks.push({ id: ++this.oilId, ownerId: player.id, x: player.kart.x - forwardX * 2.8, z: player.kart.z - forwardZ * 2.8, expiresAt: now + OIL_DURATION_MS })
      return
    }
    const forwardX = Math.sin(player.kart.heading)
    const forwardZ = Math.cos(player.kart.heading)
    const target = [...this.players.values()]
      .filter((candidate) => candidate.id !== player.id && !candidate.race.eliminated)
      .map((candidate) => {
        const dx = candidate.kart.x - player.kart.x
        const dz = candidate.kart.z - player.kart.z
        const distance = Math.hypot(dx, dz)
        return { candidate, distance, dot: dx * forwardX + dz * forwardZ, lateral: Math.abs(dx * forwardZ - dz * forwardX) }
      })
      .filter(({ distance, dot, lateral }) => distance <= 24 && dot > 0 && lateral < 3.5)
      .sort((left, right) => left.distance - right.distance)[0]?.candidate
    if (target) this.applySpin(target, player, now, item)
  }

  private processOilSlicks(players: RoomPlayer[], now: number): void {
    this.oilSlicks = this.oilSlicks.filter((slick) => {
      if (slick.expiresAt <= now) return false
      const target = players.find((player) => player.id !== slick.ownerId && distanceSquared(player.kart, slick) < 2.1 * 2.1)
      if (!target) return true
      this.applySpin(target, this.players.get(slick.ownerId) ?? null, now, 'oil-slick')
      return false
    })
  }

  private applySpin(target: RoomPlayer, source: RoomPlayer | null, now: number, item: ItemType): void {
    if (target.item.shieldedUntil !== null && target.item.shieldedUntil > now) {
      target.item.shieldedUntil = null
      this.emit({ kind: 'item-hit', playerId: source?.id ?? target.id, targetId: target.id, item, at: now })
      return
    }
    if (target.item.immuneUntil !== null && target.item.immuneUntil > now) return
    target.item.disabledUntil = Math.max(target.item.disabledUntil ?? 0, now + SPIN_DURATION_MS)
    target.item.immuneUntil = now + SPIN_IMMUNITY_MS
    target.stats.spins += 1
    if (source) source.stats.itemHits += 1
    this.emit({ kind: 'spin', playerId: source?.id ?? target.id, targetId: target.id, item, at: now })
  }

  private processHazards(players: RoomPlayer[], now: number): void {
    for (const hazard of this.track.hazards) {
      const active = this.hazardActive(hazard, now)
      if (!active) continue
      for (const player of players) {
        if (distanceSquared(player.kart, hazard) > hazard.radius * hazard.radius) continue
        const cooldown = this.hazardCooldowns.get(`${hazard.id}:${player.id}`) ?? 0
        if (cooldown > now) continue
        this.hazardCooldowns.set(`${hazard.id}:${player.id}`, now + 1_250)
        if (hazard.type === 'boost-pad') {
          player.boostUntil = Math.max(player.boostUntil, now + BOOST_DURATION_MS)
          this.emit({ kind: 'boost', playerId: player.id, at: now })
        } else {
          this.applySpin(player, null, now, 'oil-slick')
        }
      }
    }
  }

  private hazardActive(hazard: HazardDefinition, now: number): boolean {
    if (hazard.type !== 'moving-barrier' || !hazard.periodMs) return true
    const phase = ((now % hazard.periodMs) / hazard.periodMs + (hazard.phase ?? 0)) % 1
    return phase < 0.52
  }

  private emit(event: Omit<RaceEvent, 'id'>): void {
    this.events.push({ ...event, id: ++this.eventId })
    if (this.events.length > MAX_EVENTS_PER_SNAPSHOT) this.events.splice(0, this.events.length - MAX_EVENTS_PER_SNAPSHOT)
  }

  private purgeDetached(now: number): void {
    let changed = false
    for (const [id, detached] of this.detached) {
      if (detached.expiresAt > now) continue
      this.detached.delete(id)
      changed = true
    }
    if (changed && this.players.size > 0) this.broadcastLobby()
  }

  broadcastLobby(): void {
    const votes: Record<string, string> = {}
    for (const [id, trackId] of this.votes) votes[id] = trackId
    this.sendAll({
      type: 'lobby',
      roomCode: this.code,
      hostId: this.hostId,
      phase: this.phase,
      settings: copySettings(this.settings),
      trackOptions: this.trackOptions,
      votes,
      players: [
        ...[...this.players.values()].map(({ id, name, color, race }) => ({ id, name, color, connected: true, eliminated: race.eliminated })),
        ...[...this.detached.values()].map(({ player }) => ({ id: player.id, name: player.name, color: player.color, connected: false, eliminated: player.race.eliminated })),
      ],
    })
  }

  broadcastSnapshot(): void {
    const serverTime = this.now()
    const entries = [...this.players.values()].map((player) => ({ ...player.race, id: player.id, name: player.name }))
    const ranked = rankRace(entries, this.track)
    const standings = ranked.map((entry, index) => {
      const player = this.players.get(entry.id)!
      return {
        id: entry.id,
        name: entry.name,
        lap: entry.lap,
        place: index + 1,
        finished: entry.finishedAt !== null,
        eliminated: entry.eliminated,
        lapTime: entry.lapStartedAt == null || entry.finishedAt !== null ? entry.lastLapTime ?? null : serverTime - entry.lapStartedAt,
        bestLapTime: entry.bestLapTime ?? null,
        sectorTimes: [...(entry.sectorTimes ?? [])],
        awards: this.awardsFor(player, ranked),
      }
    })
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
      heldItem: player.item.heldItem,
      item: { ...player.item },
      shieldedUntil: player.item.shieldedUntil,
      immuneUntil: player.item.immuneUntil,
      disabledUntil: player.item.disabledUntil,
      eliminated: player.race.eliminated,
      stats: { ...player.stats },
    }))
    const hazards = this.track.hazards.map((hazard) => ({ id: hazard.id, type: hazard.type, x: hazard.x, z: hazard.z, active: this.hazardActive(hazard, serverTime) }))
    this.sendAll({
      type: 'snapshot',
      tick: this.tickNumber,
      serverTime,
      phase: this.phase,
      countdownEndsAt: this.countdownEndsAt,
      hostId: this.hostId,
      settings: copySettings(this.settings),
      karts,
      standings,
      itemBoxes: this.itemBoxes.map((box) => ({ ...box })),
      hazards,
      events: [...this.events],
      resumeExpiresAt: null,
    })
  }

  private awardsFor(player: RoomPlayer, ranked: Array<{ id: string }>): string[] {
    if (this.phase !== 'finished') return []
    const awards: string[] = []
    const players = [...this.players.values()]
    const fastest = players.some((candidate) => candidate.race.bestLapTime !== null && candidate.race.bestLapTime !== undefined && candidate.race.bestLapTime < (player.race.bestLapTime ?? Number.POSITIVE_INFINITY))
    if (!fastest && player.race.bestLapTime != null) awards.push('FASTEST LAP')
    if (!players.some((candidate) => candidate.stats.itemHits > player.stats.itemHits)) if (player.stats.itemHits > 0) awards.push('ITEM ACE')
    if (!players.some((candidate) => candidate.stats.overtakes > player.stats.overtakes)) if (player.stats.overtakes > 0) awards.push('COMEBACK')
    if (player.stats.spins === 0) awards.push('CLEAN RACER')
    if (ranked[0]?.id === player.id) awards.push('APEX WINNER')
    return awards
  }

  private sendAll(message: ServerMessage): void {
    for (const player of this.players.values()) sendServerMessage(player.socket, message)
  }
}
