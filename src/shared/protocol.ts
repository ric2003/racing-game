export type RacePhase = 'lobby' | 'countdown' | 'racing' | 'finished'
export type RaceMode = 'standard' | 'knockout'
export type LapCount = 2 | 3 | 5
export type ItemType = 'turbo' | 'shield' | 'pulse-bolt' | 'oil-slick'
export type QuickReaction = 'nice' | 'oops' | 'rematch'

export interface RaceSettings {
  trackId: string
  laps: LapCount
  itemsEnabled: boolean
  mode: RaceMode
}

export interface ItemState {
  heldItem: ItemType | null
  shieldedUntil: number | null
  immuneUntil: number | null
  disabledUntil: number | null
}

export interface RaceStats {
  overtakes: number
  itemHits: number
  itemsCollected: number
  spins: number
}

export interface Controls {
  throttle: number
  steer: number
  brake: number
  /** Edge-triggered action. It is only consumed once for each input sequence. */
  useItem?: boolean
}

export interface PendingInput extends Controls {
  seq: number
}

export type ClientMessage =
  | { type: 'create-room'; name: string }
  | { type: 'join-room'; name: string; roomCode: string }
  | { type: 'resume-room'; name: string; roomCode: string; token: string }
  | { type: 'start-race' }
  | { type: 'update-race-settings'; trackId: string; laps: LapCount; itemsEnabled: boolean; mode: RaceMode }
  | { type: 'cast-track-vote'; trackId: string }
  | { type: 'request-rematch' }
  | { type: 'quick-reaction'; reaction: QuickReaction }
  | { type: 'input'; seq: number; throttle: number; steer: number; brake: number; useItem?: boolean }
  | { type: 'reset' }

export interface PlayerSummary {
  id: string
  name: string
  color: number
  connected?: boolean
  eliminated?: boolean
}

export interface ItemBoxSnapshot {
  id: number
  x: number
  z: number
  availableAt: number
}

export interface HazardSnapshot {
  id: string
  type: 'boost-pad' | 'moving-barrier'
  x: number
  z: number
  active: boolean
}

export interface RaceEvent {
  id: number
  kind: 'item-pickup' | 'item-used' | 'item-hit' | 'boost' | 'spin' | 'eliminated' | 'overtake'
  playerId: string
  targetId?: string
  item?: ItemType
  at: number
}

export interface KartSnapshot {
  id: string
  name: string
  color: number
  x: number
  z: number
  heading: number
  vx: number
  vz: number
  lap: number
  nextCheckpoint: number
  finishedAt: number | null
  finishPlace: number | null
  lastProcessedSeq: number
  heldItem?: ItemType | null
  item?: ItemState
  shieldedUntil?: number | null
  immuneUntil?: number | null
  disabledUntil?: number | null
  eliminated?: boolean
  stats?: RaceStats
}

export interface Standing {
  id: string
  name: string
  lap: number
  place: number
  finished: boolean
  eliminated?: boolean
  lapTime?: number | null
  bestLapTime?: number | null
  sectorTimes?: number[]
  awards?: string[]
}

export type ServerMessage =
  | { type: 'welcome'; playerId: string; roomCode: string; reconnectToken: string }
  | {
      type: 'lobby'
      roomCode: string
      hostId: string
      phase: RacePhase
      players: PlayerSummary[]
      settings?: RaceSettings
      trackOptions?: Array<{ id: string; name: string }>
      votes?: Record<string, string>
    }
  | {
      type: 'snapshot'
      tick: number
      serverTime: number
      phase: RacePhase
      countdownEndsAt: number | null
      hostId: string
      karts: KartSnapshot[]
      standings: Standing[]
      settings?: RaceSettings
      itemBoxes?: ItemBoxSnapshot[]
      hazards?: HazardSnapshot[]
      events?: RaceEvent[]
      resumeExpiresAt?: number | null
    }
  | { type: 'error'; code: string; message: string }
  | { type: 'reaction'; playerId: string; name: string; reaction: QuickReaction; at: number }

export const NEUTRAL_CONTROLS: Controls = { throttle: 0, steer: 0, brake: 0 }
