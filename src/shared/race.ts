import { DEFAULT_TRACK, crossedCheckpoint, nearestTrackPoint, type Point2, type TrackDefinition } from './track.js'
import { LAPS_TO_WIN } from './constants.js'

export interface RaceProgress {
  lap: number
  nextCheckpoint: number
  trackProgress: number
  finishedAt: number | null
  finishPlace: number | null
  raceStartedAt?: number | null
  lapStartedAt?: number | null
  sectorStartedAt?: number | null
  lastLapTime?: number | null
  bestLapTime?: number | null
  sectorTimes?: number[]
  bestSectorTimes?: number[]
  eliminated?: boolean
  eliminatedAt?: number | null
}

export interface RaceEntry extends RaceProgress {
  id: string
  name: string
}

export function createRaceProgress(): RaceProgress {
  return {
    lap: 0,
    nextCheckpoint: 1,
    trackProgress: 0,
    finishedAt: null,
    finishPlace: null,
    raceStartedAt: null,
    lapStartedAt: null,
    sectorStartedAt: null,
    lastLapTime: null,
    bestLapTime: null,
    sectorTimes: [],
    bestSectorTimes: [],
    eliminated: false,
    eliminatedAt: null,
  }
}

export function beginRaceTiming(progress: RaceProgress, now: number): void {
  if (progress.raceStartedAt != null) return
  progress.raceStartedAt = now
  progress.lapStartedAt = now
  progress.sectorStartedAt = now
  progress.sectorTimes = []
  progress.bestSectorTimes ??= []
}

export function updateRaceProgress(
  progress: RaceProgress,
  previous: Point2,
  current: Point2,
  now: number,
  track: TrackDefinition = DEFAULT_TRACK,
  lapsToWin = LAPS_TO_WIN,
): void {
  progress.trackProgress = nearestTrackPoint(current, track).progress
  if (progress.finishedAt !== null || progress.eliminated) return
  beginRaceTiming(progress, now)
  const checkpoint = track.checkpoints[progress.nextCheckpoint]
  if (!crossedCheckpoint(previous, current, checkpoint)) return
  const sectorTime = progress.sectorStartedAt == null ? null : now - progress.sectorStartedAt
  if (sectorTime !== null && Number.isFinite(sectorTime)) {
    progress.sectorTimes ??= []
    progress.bestSectorTimes ??= []
    progress.sectorTimes.push(sectorTime)
    const sectorIndex = progress.sectorTimes.length - 1
    const previousBest = progress.bestSectorTimes[sectorIndex]
    if (previousBest === undefined || sectorTime < previousBest) progress.bestSectorTimes[sectorIndex] = sectorTime
  }
  if (progress.nextCheckpoint === 0) {
    progress.lap += 1
    progress.nextCheckpoint = 1
    if (progress.lapStartedAt != null) {
      progress.lastLapTime = now - progress.lapStartedAt
      if (progress.bestLapTime == null || progress.lastLapTime < progress.bestLapTime) progress.bestLapTime = progress.lastLapTime
    }
    progress.lapStartedAt = now
    progress.sectorStartedAt = now
    progress.sectorTimes = []
    if (progress.lap >= lapsToWin) progress.finishedAt = now
  } else {
    progress.nextCheckpoint = (progress.nextCheckpoint + 1) % track.checkpoints.length
  }
}

export function applyFinishPlaces(entries: RaceEntry[]): void {
  const finished = entries
    .filter((entry) => entry.finishedAt !== null)
    .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0) || a.id.localeCompare(b.id))
  finished.forEach((entry, index) => {
    entry.finishPlace = index + 1
  })
}

function totalRaceProgress(entry: RaceEntry, track: TrackDefinition): number {
  const checkpointProgress = track.checkpoints.map((checkpoint) => nearestTrackPoint(checkpoint, track).progress)
  const segmentCount = track.checkpoints.length
  const stage = entry.nextCheckpoint === 0 ? segmentCount - 1 : entry.nextCheckpoint - 1
  const segmentStart = checkpointProgress[stage]
  const segmentEnd = stage === segmentCount - 1 ? 1 : checkpointProgress[stage + 1]
  let inLapProgress = entry.trackProgress
  if (stage === 0 && inLapProgress > segmentEnd) inLapProgress = segmentStart
  inLapProgress = Math.max(segmentStart, Math.min(segmentEnd, inLapProgress))
  return entry.lap + inLapProgress
}

export function rankRace(entries: RaceEntry[], track: TrackDefinition = DEFAULT_TRACK): RaceEntry[] {
  return [...entries].sort((a, b) => {
    if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1
    if (a.finishedAt !== null || b.finishedAt !== null) {
      if (a.finishedAt === null) return 1
      if (b.finishedAt === null) return -1
      return (a.finishPlace ?? Number.MAX_SAFE_INTEGER) - (b.finishPlace ?? Number.MAX_SAFE_INTEGER)
        || a.finishedAt - b.finishedAt
        || a.id.localeCompare(b.id)
    }
    return totalRaceProgress(b, track) - totalRaceProgress(a, track) || a.id.localeCompare(b.id)
  })
}
