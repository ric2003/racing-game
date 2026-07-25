export type RacePhase = 'lobby' | 'countdown' | 'racing' | 'finished'

export interface Controls {
  throttle: number
  steer: number
  brake: number
}

export interface PendingInput extends Controls {
  seq: number
}

export type ClientMessage =
  | { type: 'create-room'; name: string }
  | { type: 'join-room'; name: string; roomCode: string }
  | { type: 'start-race' }
  | { type: 'input'; seq: number; throttle: number; steer: number; brake: number }
  | { type: 'reset' }

export interface PlayerSummary {
  id: string
  name: string
  color: number
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
}

export interface Standing {
  id: string
  name: string
  lap: number
  place: number
  finished: boolean
}

export type ServerMessage =
  | { type: 'welcome'; playerId: string; roomCode: string }
  | { type: 'lobby'; roomCode: string; hostId: string; phase: RacePhase; players: PlayerSummary[] }
  | {
      type: 'snapshot'
      tick: number
      serverTime: number
      phase: RacePhase
      countdownEndsAt: number | null
      hostId: string
      karts: KartSnapshot[]
      standings: Standing[]
    }
  | { type: 'error'; code: string; message: string }

export const NEUTRAL_CONTROLS: Controls = { throttle: 0, steer: 0, brake: 0 }
