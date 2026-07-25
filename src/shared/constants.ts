export const FIXED_DT = 1 / 60
export const SNAPSHOT_EVERY_TICKS = 3
export const INPUT_INTERVAL = 1 / 30
export const INTERPOLATION_DELAY_MS = 100
export const MAX_CATCH_UP_STEPS = 5
export const MAX_PLAYERS = 4
export const LAPS_TO_WIN = 3
export const COUNTDOWN_MS = 3_000
export const KART_RADIUS = 1.15
export const TRACK_WIDTH = 15
export const MAX_MESSAGE_BYTES = 1_024
export const INPUT_IDLE_MS = 250

export const HANDLING = {
  acceleration: 22,
  reverseAcceleration: 12,
  brakeForce: 34,
  rollingDrag: 1.3,
  aerodynamicDrag: 0.035,
  lateralGrip: 9,
  maxForwardSpeed: 31,
  maxReverseSpeed: 10,
  steeringRate: 2.1,
} as const
