import { CHECKPOINTS, crossedCheckpoint, nearestTrackPoint, type Point2 } from './track.js'
import { LAPS_TO_WIN } from './constants.js'

export interface RaceProgress {
  lap: number
  nextCheckpoint: number
  trackProgress: number
  finishedAt: number | null
  finishPlace: number | null
}

export interface RaceEntry extends RaceProgress {
  id: string
  name: string
}

export function createRaceProgress(): RaceProgress {
  return { lap: 0, nextCheckpoint: 1, trackProgress: 0, finishedAt: null, finishPlace: null }
}

export function updateRaceProgress(progress: RaceProgress, previous: Point2, current: Point2, now: number): void {
  progress.trackProgress = nearestTrackPoint(current).progress
  if (progress.finishedAt !== null) return
  const checkpoint = CHECKPOINTS[progress.nextCheckpoint]
  if (!crossedCheckpoint(previous, current, checkpoint)) return
  if (progress.nextCheckpoint === 0) {
    progress.lap += 1
    progress.nextCheckpoint = 1
    if (progress.lap >= LAPS_TO_WIN) progress.finishedAt = now
  } else {
    progress.nextCheckpoint = (progress.nextCheckpoint + 1) % CHECKPOINTS.length
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

const CHECKPOINT_PROGRESS = CHECKPOINTS.map((checkpoint) => nearestTrackPoint(checkpoint).progress)

function totalRaceProgress(entry: RaceEntry): number {
  const segmentCount = CHECKPOINTS.length
  const stage = entry.nextCheckpoint === 0 ? segmentCount - 1 : entry.nextCheckpoint - 1
  const segmentStart = CHECKPOINT_PROGRESS[stage]
  const segmentEnd = stage === segmentCount - 1 ? 1 : CHECKPOINT_PROGRESS[stage + 1]
  let inLapProgress = entry.trackProgress
  if (stage === 0 && inLapProgress > segmentEnd) inLapProgress = segmentStart
  inLapProgress = Math.max(segmentStart, Math.min(segmentEnd, inLapProgress))
  return entry.lap + inLapProgress
}

export function rankRace(entries: RaceEntry[]): RaceEntry[] {
  return [...entries].sort((a, b) => {
    if (a.finishedAt !== null || b.finishedAt !== null) {
      if (a.finishedAt === null) return 1
      if (b.finishedAt === null) return -1
      return (a.finishPlace ?? Number.MAX_SAFE_INTEGER) - (b.finishPlace ?? Number.MAX_SAFE_INTEGER)
        || a.finishedAt - b.finishedAt
        || a.id.localeCompare(b.id)
    }
    return totalRaceProgress(b) - totalRaceProgress(a) || a.id.localeCompare(b.id)
  })
}
