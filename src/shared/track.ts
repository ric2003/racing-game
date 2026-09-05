import { LONG_LAYOUTS } from './long-layouts.js'
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
  theme?: 'forest' | 'harbor' | 'desert'
}

const TRACK_ANCHORS: Point2[] = [
  { x: -20, z: -50 },
  { x: 18, z: -50 },
  { x: 52, z: -44 },
  { x: 72, z: -28 },
  { x: 80, z: -4 },
  { x: 72, z: 22 },
  { x: 54, z: 45 },
  { x: 24, z: 60 },
  { x: -10, z: 64 },
  { x: -42, z: 56 },
  { x: -68, z: 40 },
  { x: -82, z: 18 },
  { x: -82, z: -10 },
  { x: -72, z: -34 },
  { x: -52, z: -48 },
]

const SAMPLES_PER_ANCHOR = 10
const POINT_COUNT = TRACK_ANCHORS.length * SAMPLES_PER_ANCHOR
const CHECKPOINT_COUNT = 8

function anchor(index: number, anchors: Point2[]): Point2 {
  return anchors[(index + anchors.length) % anchors.length]
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

function sampleTrack(amount: number, anchors = TRACK_ANCHORS): Point2 {
  const scaled = amount * anchors.length
  const index = Math.floor(scaled) % anchors.length
  const local = scaled - Math.floor(scaled)
  const previous = anchor(index - 1, anchors)
  const current = anchor(index, anchors)
  const next = anchor(index + 1, anchors)
  const following = anchor(index + 2, anchors)
  return {
    x: catmullRom(previous.x, current.x, next.x, following.x, local),
    z: catmullRom(previous.z, current.z, next.z, following.z, local),
  }
}

const CLASSIC_POINTS: Point2[] = Array.from(
  { length: POINT_COUNT },
  (_, index) => sampleTrack(index / POINT_COUNT),
)

function buildCheckpoints(points: Point2[], count = CHECKPOINT_COUNT): Checkpoint[] {
  return Array.from({ length: count }, (_, index) => {
    const trackIndex = Math.floor(index * points.length / count)
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

interface HazardPlacement extends Omit<HazardDefinition, 'x' | 'z'> {
  progress: number
  lateralOffset?: number
}

function pointAtProgress(points: Point2[], progress: number, lateralOffset = 0): Point2 {
  const index = Math.floor(progress * points.length) % points.length
  const point = points[index]
  const next = points[(index + 1) % points.length]
  const dx = next.x - point.x
  const dz = next.z - point.z
  const length = Math.max(0.0001, Math.hypot(dx, dz))
  return {
    x: point.x + (dz / length) * lateralOffset,
    z: point.z - (dx / length) * lateralOffset,
  }
}

function buildTrack(id: string, name: string, points: Point2[], hazardPlacements: HazardPlacement[] = [], theme?: TrackDefinition['theme']): TrackDefinition {
  const checkpoints = buildCheckpoints(points, theme ? 64 : CHECKPOINT_COUNT)
  const itemBoxes = (theme ? Array.from({ length: 64 }, (_, index) => (index + 0.5) / 64) : [0.08, 0.19, 0.31, 0.44, 0.57, 0.7, 0.83, 0.94])
    .map((progress, index) => pointAtProgress(points, progress, index % 2 === 0 ? -3.1 : 3.1))
  const hazards = hazardPlacements.map(({ progress, lateralOffset = 0, ...hazard }) => ({
    ...hazard,
    ...pointAtProgress(points, progress, lateralOffset),
  }))
  return {
    id,
    version: 2,
    name,
    points,
    checkpoints,
    startGrid: buildStartGrid(checkpoints),
    itemBoxes,
    hazards,
    theme,
  }
}

const classicHazards: HazardPlacement[] = [
  { id: 'classic-boost-1', type: 'boost-pad', progress: 0.13, radius: 2.6 },
  { id: 'classic-boost-2', type: 'boost-pad', progress: 0.66, radius: 2.6 },
  { id: 'classic-barrier', type: 'moving-barrier', progress: 0.34, lateralOffset: 2.8, radius: 1.9, periodMs: 3_600 },
]

const CLASSIC_TRACK = buildTrack('neon-classic', 'Neon Classic', CLASSIC_POINTS, classicHazards)
const HARBOR_POINTS = CLASSIC_POINTS.map(({ x, z }) => ({ x: x * 1.08 + 8, z: z * 0.86 - 6 }))
const SWITCHBACK_POINTS = CLASSIC_POINTS.map(({ x, z }) => ({ x: z * 0.9 - 3, z: -x * 0.82 + 8 }))

function circuitLength(points: Point2[]): number {
  return points.reduce((total, point, index) => {
    const next = points[(index + 1) % points.length]
    return total + Math.hypot(next.x - point.x, next.z - point.z)
  }, 0)
}

function buildLongCircuit(anchors: Point2[]): Point2[] {
  const samples = Array.from({ length: anchors.length * 100 }, (_, index) => sampleTrack(index / (anchors.length * 100), anchors))
  const targetLength = circuitLength(CLASSIC_POINTS) * 10
  const scale = targetLength / circuitLength(samples)
  const scaled = samples.map(({ x, z }) => ({ x: x * scale, z: z * scale }))
  const cumulative = [0]
  for (let index = 0; index < scaled.length; index += 1) {
    const next = scaled[(index + 1) % scaled.length]
    cumulative.push(cumulative[index] + Math.hypot(next.x - scaled[index].x, next.z - scaled[index].z))
  }
  // Uniform distance spacing preserves corner detail and regular checkpoint intervals.
  const count = Math.ceil(targetLength / 3)
  let segment = 0
  return Array.from({ length: count }, (_, index) => {
    const distance = index * targetLength / count
    while (segment < scaled.length - 1 && cumulative[segment + 1] < distance) segment += 1
    const amount = (distance - cumulative[segment]) / (cumulative[segment + 1] - cumulative[segment])
    const start = scaled[segment]
    const end = scaled[(segment + 1) % scaled.length]
    return { x: start.x + (end.x - start.x) * amount, z: start.z + (end.z - start.z) * amount }
  })
}

export const TRACKS: TrackDefinition[] = [
  CLASSIC_TRACK,
  buildTrack('neon-harbor', 'Neon Harbor', HARBOR_POINTS, [
    { id: 'harbor-boost-1', type: 'boost-pad', progress: 0.17, radius: 2.6 },
    { id: 'harbor-barrier', type: 'moving-barrier', progress: 0.48, lateralOffset: -2.8, radius: 1.9, periodMs: 3_200, phase: 0.5 },
  ]),
  buildTrack('skyway-switchbacks', 'Skyway Switchbacks', SWITCHBACK_POINTS, [
    { id: 'skyway-boost-1', type: 'boost-pad', progress: 0.72, radius: 2.6 },
    { id: 'skyway-barrier', type: 'moving-barrier', progress: 0.27, lateralOffset: 2.8, radius: 1.9, periodMs: 4_100, phase: 0.25 },
  ]),
]

for (const layout of LONG_LAYOUTS) {
  const hazards: HazardPlacement[] = Array.from({ length: 16 }, (_, index) => ({
    id: `${layout.id}-boost-${index}`, type: 'boost-pad', radius: 2.6,
    progress: (index + 0.3) / 16,
  }))
  for (let index = 0; index < 8; index += 1) hazards.push({
    id: `${layout.id}-barrier-${index}`, type: 'moving-barrier', radius: 1.9,
    progress: (index + 0.4) / 8, lateralOffset: index % 2 ? -2.8 : 2.8,
    periodMs: 3_600 + index * 100, phase: index / 8,
  })
  TRACKS.push(buildTrack(layout.id, layout.name, buildLongCircuit(layout.anchors), hazards, layout.theme))
}

export const TRACK_DEFINITIONS = TRACKS

export const DEFAULT_TRACK = CLASSIC_TRACK
export const TRACK_POINTS = DEFAULT_TRACK.points
export const CHECKPOINTS = DEFAULT_TRACK.checkpoints
export const START_GRID = DEFAULT_TRACK.startGrid

export function getTrack(trackId: string | undefined): TrackDefinition {
  return TRACKS.find((track) => track.id === trackId) ?? DEFAULT_TRACK
}

export interface TrackBounds { minX: number; maxX: number; minZ: number; maxZ: number }
type SegmentBlock = TrackBounds & { start: number; end: number }
type TrackMetrics = { lengths: number[]; total: number; cumulative: number[]; blocks: SegmentBlock[]; bounds: TrackBounds }
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
  const blocks: SegmentBlock[] = []
  for (let start = 0; start < track.points.length; start += 32) {
    const end = Math.min(track.points.length, start + 32)
    const points = track.points.slice(start, end)
    points.push(track.points[end % track.points.length])
    blocks.push({ start, end, ...boundsOf(points) })
  }
  const metrics = { lengths, total, cumulative, blocks, bounds: boundsOf(track.points) }
  metricsCache.set(track, metrics)
  return metrics
}

function boundsOf(points: Point2[]): TrackBounds {
  return points.reduce((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x), maxX: Math.max(bounds.maxX, point.x),
    minZ: Math.min(bounds.minZ, point.z), maxZ: Math.max(bounds.maxZ, point.z),
  }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity })
}

export function getTrackBounds(track: TrackDefinition): TrackBounds { return trackMetrics(track).bounds }
export function getTrackLength(track: TrackDefinition): number { return trackMetrics(track).total }
export function finishGraceMs(track: TrackDefinition): number {
  return Math.max(20_000, Math.round(getTrackLength(track) / getTrackLength(DEFAULT_TRACK)) * 20_000)
}

export function nearestTrackPoint(point: Point2, track: TrackDefinition = DEFAULT_TRACK): TrackProjection {
  const { lengths, total, cumulative, blocks } = trackMetrics(track)
  let bestDistanceSquared = Infinity
  let bestIndex = 0
  let bestAmount = 0
  let bestX = 0
  let bestZ = 0
  for (const block of blocks) {
    const gapX = Math.max(block.minX - point.x, 0, point.x - block.maxX)
    const gapZ = Math.max(block.minZ - point.z, 0, point.z - block.maxZ)
    if (gapX * gapX + gapZ * gapZ > bestDistanceSquared) continue
    for (let index = block.start; index < block.end; index += 1) {
      const start = track.points[index]
      const end = track.points[(index + 1) % track.points.length]
      const dx = end.x - start.x
      const dz = end.z - start.z
      const amount = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / (dx * dx + dz * dz)))
      const x = start.x + dx * amount
      const z = start.z + dz * amount
      const distanceSquared = (point.x - x) ** 2 + (point.z - z) ** 2
      if (distanceSquared < bestDistanceSquared) {
        bestDistanceSquared = distanceSquared
        bestIndex = index
        bestAmount = amount
        bestX = x
        bestZ = z
      }
    }
  }
  const start = track.points[bestIndex]
  const end = track.points[(bestIndex + 1) % track.points.length]
  return {
    x: bestX, z: bestZ, distance: Math.sqrt(bestDistanceSquared), segmentIndex: bestIndex,
    tangentX: (end.x - start.x) / lengths[bestIndex], tangentZ: (end.z - start.z) / lengths[bestIndex],
    progress: (cumulative[bestIndex] + lengths[bestIndex] * bestAmount) / total,
  }
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
