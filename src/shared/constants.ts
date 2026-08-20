export const FIXED_DT = 1 / 60
export const SNAPSHOT_EVERY_TICKS = 3
export const INPUT_INTERVAL = 1 / 30
export const INPUT_STEPS_PER_SAMPLE = 2
export const INTERPOLATION_DELAY_MS = 100
export const MAX_CATCH_UP_STEPS = 5
export const MAX_PLAYERS = 4
export const LAPS_TO_WIN = 3
export const DEFAULT_RACE_SETTINGS = {
  trackId: 'neon-classic',
  laps: 3 as const,
  itemsEnabled: true,
  mode: 'standard' as const,
}
export const COUNTDOWN_MS = 3_000
export const ITEM_BOX_RESPAWN_MS = 6_000
export const RESUME_WINDOW_MS = 60_000
export const SPIN_IMMUNITY_MS = 1_250
export const SPIN_DURATION_MS = 650
export const OIL_DURATION_MS = 10_000
export const BOOST_DURATION_MS = 900
export const BOOST_ACCELERATION_MULTIPLIER = 2
export const BOOST_MAX_SPEED_MULTIPLIER = 1.25
export const MOVING_BARRIER_TRAVEL = 4.5
export const SHIELD_DURATION_MS = 8_000
export const MAX_EVENTS_PER_SNAPSHOT = 32
export const KART_RADIUS = 1.15
export const TRACK_WIDTH = 17
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
