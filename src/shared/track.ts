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

const POINT_COUNT = 160

export const TRACK_POINTS: Point2[] = Array.from({ length: POINT_COUNT }, (_, index) => {
  const angle = -Math.PI / 2 + (index / POINT_COUNT) * Math.PI * 2
  return {
    x: Math.cos(angle) * (90 + Math.sin(angle * 3) * 8 + Math.sin(angle * 5) * 10),
    z: Math.sin(angle) * (65 + Math.cos(angle * 4) * 8),
  }
})

const segmentLengths = TRACK_POINTS.map((point, index) => {
  const next = TRACK_POINTS[(index + 1) % TRACK_POINTS.length]
  return Math.hypot(next.x - point.x, next.z - point.z)
})
const totalLength = segmentLengths.reduce((sum, length) => sum + length, 0)
const cumulative: number[] = []
segmentLengths.reduce((sum, length) => {
  cumulative.push(sum)
  return sum + length
}, 0)

export function nearestTrackPoint(point: Point2): TrackProjection {
  let best: TrackProjection | null = null
  for (let index = 0; index < TRACK_POINTS.length; index += 1) {
    const start = TRACK_POINTS[index]
    const end = TRACK_POINTS[(index + 1) % TRACK_POINTS.length]
    const dx = end.x - start.x
    const dz = end.z - start.z
    const lengthSquared = dx * dx + dz * dz
    const amount = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared))
    const x = start.x + dx * amount
    const z = start.z + dz * amount
    const distance = Math.hypot(point.x - x, point.z - z)
    if (!best || distance < best.distance) {
      const length = segmentLengths[index]
      best = {
        x,
        z,
        distance,
        segmentIndex: index,
        tangentX: dx / length,
        tangentZ: dz / length,
        progress: (cumulative[index] + length * amount) / totalLength,
      }
    }
  }
  return best!
}

function checkpointAt(trackIndex: number, index: number): Checkpoint {
  const point = TRACK_POINTS[trackIndex]
  const next = TRACK_POINTS[(trackIndex + 1) % TRACK_POINTS.length]
  const length = Math.hypot(next.x - point.x, next.z - point.z)
  return {
    index,
    x: point.x,
    z: point.z,
    normalX: (next.x - point.x) / length,
    normalZ: (next.z - point.z) / length,
  }
}

const CHECKPOINT_COUNT = 8
export const CHECKPOINTS = Array.from(
  { length: CHECKPOINT_COUNT },
  (_, index) => checkpointAt(index * (POINT_COUNT / CHECKPOINT_COUNT), index),
)

export const START_GRID = Array.from({ length: 4 }, (_, index) => {
  const start = CHECKPOINTS[0]
  const sideX = start.normalZ
  const sideZ = -start.normalX
  const row = Math.floor(index / 2)
  const column = index % 2 === 0 ? -1 : 1
  return {
    x: start.x - start.normalX * (5 + row * 3.1) + sideX * column * 1.8,
    z: start.z - start.normalZ * (5 + row * 3.1) + sideZ * column * 1.8,
    heading: Math.atan2(start.normalX, start.normalZ),
  }
})

export function crossedCheckpoint(previous: Point2, current: Point2, checkpoint: Checkpoint): boolean {
  const before = (previous.x - checkpoint.x) * checkpoint.normalX + (previous.z - checkpoint.z) * checkpoint.normalZ
  const after = (current.x - checkpoint.x) * checkpoint.normalX + (current.z - checkpoint.z) * checkpoint.normalZ
  if (before > 0 || after <= 0) return false
  const sideX = checkpoint.normalZ
  const sideZ = -checkpoint.normalX
  const lateral = Math.abs((current.x - checkpoint.x) * sideX + (current.z - checkpoint.z) * sideZ)
  return lateral <= TRACK_WIDTH / 2
}

export function legalTrackRadius(): number {
  return TRACK_WIDTH / 2 - KART_RADIUS
}
