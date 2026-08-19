import { KART_RADIUS, TRACK_WIDTH } from './constants.js'

export interface Point2 {
  x: number
  z: number
}

export interface TrackProjection extends Point2 {
  distance: number
  progress: number
  segmentIndex: number
  tangentX: number
  tangentZ: number
}

export interface Checkpoint extends Point2 {
  index: number
  normalX: number
  normalZ: number
}

export interface StartPosition extends Point2 {
  heading: number
}

export interface HazardDefinition extends Point2 {
  id: string
  type: 'boost-pad' | 'moving-barrier'
  radius: number
  periodMs?: number
  phase?: number
}

export interface TrackDefinition {
  id: string
  version: number
  name: string
  points: Point2[]
  checkpoints: Checkpoint[]
  startGrid: StartPosition[]
  itemBoxes: Point2[]
  hazards: HazardDefinition[]
}

const TRACK_ANCHORS: Point2[] = [
  { x: -52, z: -48 },
  { x: -24, z: -48 },
  { x: 8, z: -48 },
  { x: 44, z: -46 },
  { x: 68, z: -34 },
  { x: 74, z: -12 },
  { x: 60, z: 4 },
  { x: 38, z: 12 },
  { x: 20, z: 28 },
  { x: 40, z: 46 },
  { x: 28, z: 62 },
  { x: 0, z: 64 },
  { x: -20, z: 52 },
  { x: -12, z: 34 },
  { x: -38, z: 28 },
  { x: -68, z: 40 },
  { x: -84, z: 20 },
  { x: -78, z: -4 },
  { x: -60, z: -12 },
  { x: -76, z: -28 },
  { x: -72, z: -44 },
]

const SAMPLES_PER_ANCHOR = 8
const POINT_COUNT = TRACK_ANCHORS.length * SAMPLES_PER_ANCHOR
const CHECKPOINT_COUNT = 8

function anchor(index: number): Point2 {
  return TRACK_ANCHORS[(index + TRACK_ANCHORS.length) % TRACK_ANCHORS.length]
}

function catmullRom(value0: number, value1: number, value2: number, value3: number, amount: number): number {
  const squared = amount * amount
  const cubed = squared * amount
  return 0.5 * (
    2 * value1
    + (-value0 + value2) * amount
    + (2 * value0 - 5 * value1 + 4 * value2 - value3) * squared
    + (-value0 + 3 * value1 - 3 * value2 + value3) * cubed
  )
}

function sampleTrack(amount: number): Point2 {
  const scaled = amount * TRACK_ANCHORS.length
  const index = Math.floor(scaled) % TRACK_ANCHORS.length
  const local = scaled - Math.floor(scaled)
  const previous = anchor(index - 1)
  const current = anchor(index)
  const next = anchor(index + 1)
  const following = anchor(index + 2)
  return {
    x: catmullRom(previous.x, current.x, next.x, following.x, local),
    z: catmullRom(previous.z, current.z, next.z, following.z, local),
  }
}

const CLASSIC_POINTS: Point2[] = Array.from(
  { length: POINT_COUNT },
  (_, index) => sampleTrack(index / POINT_COUNT),
)

function buildCheckpoints(points: Point2[]): Checkpoint[] {
  return Array.from({ length: CHECKPOINT_COUNT }, (_, index) => {
    const trackIndex = index * (points.length / CHECKPOINT_COUNT)
    const point = points[trackIndex]
    const next = points[(trackIndex + 1) % points.length]
    const length = Math.max(0.0001, Math.hypot(next.x - point.x, next.z - point.z))
    return {
      index,
      x: point.x,
      z: point.z,
      normalX: (next.x - point.x) / length,
      normalZ: (next.z - point.z) / length,
    }
  })
}

function buildStartGrid(checkpoints: Checkpoint[]): StartPosition[] {
  const start = checkpoints[0]
  const sideX = start.normalZ
  const sideZ = -start.normalX
  return Array.from({ length: 4 }, (_, index) => {
    const row = Math.floor(index / 2)
    const column = index % 2 === 0 ? -1 : 1
    return {
      x: start.x - start.normalX * (5 + row * 3.1) + sideX * column * 1.8,
      z: start.z - start.normalZ * (5 + row * 3.1) + sideZ * column * 1.8,
      heading: Math.atan2(start.normalX, start.normalZ),
    }
  })
}

function buildTrack(id: string, name: string, points: Point2[], hazards: HazardDefinition[] = []): TrackDefinition {
  const checkpoints = buildCheckpoints(points)
  const itemBoxes = [0.08, 0.19, 0.31, 0.44, 0.57, 0.7, 0.83, 0.94].map((progress) => {
    const index = Math.floor(progress * points.length) % points.length
    return { ...points[index] }
  })
  return {
    id,
    version: 1,
    name,
    points,
    checkpoints,
    startGrid: buildStartGrid(checkpoints),
    itemBoxes,
    hazards,
  }
}

const classicHazards: HazardDefinition[] = [
  { id: 'classic-boost-1', type: 'boost-pad', x: 26, z: -48, radius: 2.6 },
  { id: 'classic-boost-2', type: 'boost-pad', x: -48, z: 34, radius: 2.6 },
  { id: 'classic-barrier', type: 'moving-barrier', x: 49, z: 6, radius: 2.1, periodMs: 3_600 },
]

const CLASSIC_TRACK = buildTrack('neon-classic', 'Neon Classic', CLASSIC_POINTS, classicHazards)
const HARBOR_POINTS = CLASSIC_POINTS.map(({ x, z }) => ({ x: x * 1.08 + 8, z: z * 0.86 - 6 }))
const SWITCHBACK_POINTS = CLASSIC_POINTS.map(({ x, z }) => ({ x: z * 0.9 - 3, z: -x * 0.82 + 8 }))

export const TRACKS: TrackDefinition[] = [
  CLASSIC_TRACK,
  buildTrack('neon-harbor', 'Neon Harbor', HARBOR_POINTS, [
    { id: 'harbor-boost-1', type: 'boost-pad', x: 35, z: -47, radius: 2.6 },
    { id: 'harbor-barrier', type: 'moving-barrier', x: 53, z: 4, radius: 2.2, periodMs: 3_200, phase: 0.5 },
  ]),
  buildTrack('skyway-switchbacks', 'Skyway Switchbacks', SWITCHBACK_POINTS, [
    { id: 'skyway-boost-1', type: 'boost-pad', x: -38, z: 42, radius: 2.6 },
    { id: 'skyway-barrier', type: 'moving-barrier', x: 42, z: 20, radius: 2.1, periodMs: 4_100, phase: 0.25 },
  ]),
]

export const TRACK_DEFINITIONS = TRACKS

export const DEFAULT_TRACK = CLASSIC_TRACK
export const TRACK_POINTS = DEFAULT_TRACK.points
export const CHECKPOINTS = DEFAULT_TRACK.checkpoints
export const START_GRID = DEFAULT_TRACK.startGrid

export function getTrack(trackId: string | undefined): TrackDefinition {
  return TRACKS.find((track) => track.id === trackId) ?? DEFAULT_TRACK
}

type TrackMetrics = { lengths: number[]; total: number; cumulative: number[] }
const metricsCache = new WeakMap<TrackDefinition, TrackMetrics>()

function trackMetrics(track: TrackDefinition): TrackMetrics {
  const cached = metricsCache.get(track)
  if (cached) return cached
  const lengths = track.points.map((point, index) => {
    const next = track.points[(index + 1) % track.points.length]
    return Math.max(0.0001, Math.hypot(next.x - point.x, next.z - point.z))
  })
  const cumulative: number[] = []
  const total = lengths.reduce((sum, length) => {
    cumulative.push(sum)
    return sum + length
  }, 0)
  const metrics = { lengths, total, cumulative }
  metricsCache.set(track, metrics)
  return metrics
}

export function nearestTrackPoint(point: Point2, track: TrackDefinition = DEFAULT_TRACK): TrackProjection {
  const { lengths, total, cumulative } = trackMetrics(track)
  let best: TrackProjection | null = null
  for (let index = 0; index < track.points.length; index += 1) {
    const start = track.points[index]
    const end = track.points[(index + 1) % track.points.length]
    const dx = end.x - start.x
    const dz = end.z - start.z
    const lengthSquared = dx * dx + dz * dz
    const amount = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared))
    const x = start.x + dx * amount
    const z = start.z + dz * amount
    const distance = Math.hypot(point.x - x, point.z - z)
    if (!best || distance < best.distance) {
      const length = lengths[index]
      best = {
        x,
        z,
        distance,
        segmentIndex: index,
        tangentX: dx / length,
        tangentZ: dz / length,
        progress: (cumulative[index] + length * amount) / total,
      }
    }
  }
  return best!
}

export function crossedCheckpoint(previous: Point2, current: Point2, checkpoint: Checkpoint, trackWidth = TRACK_WIDTH): boolean {
  const before = (previous.x - checkpoint.x) * checkpoint.normalX + (previous.z - checkpoint.z) * checkpoint.normalZ
  const after = (current.x - checkpoint.x) * checkpoint.normalX + (current.z - checkpoint.z) * checkpoint.normalZ
  if (before > 0 || after <= 0) return false
  const sideX = checkpoint.normalZ
  const sideZ = -checkpoint.normalX
  const lateral = Math.abs((current.x - checkpoint.x) * sideX + (current.z - checkpoint.z) * sideZ)
  return lateral <= trackWidth / 2
}

export function legalTrackRadius(trackWidth = TRACK_WIDTH): number {
  return trackWidth / 2 - KART_RADIUS
}
