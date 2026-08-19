import { describe, expect, it } from 'vitest'
import { beginRaceTiming, createRaceProgress, rankRace, updateRaceProgress, type RaceEntry } from '../../src/shared/race.js'
import { CHECKPOINTS, nearestTrackPoint } from '../../src/shared/track.js'

function entry(id: string, overrides: Partial<RaceEntry> = {}): RaceEntry {
  return {
    id,
    name: id,
    lap: 0,
    nextCheckpoint: 1,
    trackProgress: 0,
    finishedAt: null,
    finishPlace: null,
    ...overrides,
  }
}

function cross(index: number) {
  const checkpoint = CHECKPOINTS[index]
  return {
    previous: { x: checkpoint.x - checkpoint.normalX, z: checkpoint.z - checkpoint.normalZ },
    current: { x: checkpoint.x + checkpoint.normalX, z: checkpoint.z + checkpoint.normalZ },
  }
}

describe('race progress', () => {
  it('rejects checkpoints crossed out of order', () => {
    const race = createRaceProgress()
    const wrong = cross(2)
    updateRaceProgress(race, wrong.previous, wrong.current, 100)
    expect(race.nextCheckpoint).toBe(1)
    expect(race.lap).toBe(0)
  })

  it('counts ordered checkpoints and finishes on lap three', () => {
    const race = createRaceProgress()
    let time = 100
    for (let lap = 0; lap < 3; lap += 1) {
      for (const checkpoint of [...CHECKPOINTS.slice(1).map(({ index }) => index), 0]) {
        const crossing = cross(checkpoint)
        updateRaceProgress(race, crossing.previous, crossing.current, time += 100)
      }
      expect(race.lap).toBe(lap + 1)
    }
    expect(race.finishedAt).toBe(time)
    expect(race.nextCheckpoint).toBe(1)
  })

  it.each(CHECKPOINTS.map((_, stage) => {
    const nextCheckpoint = (stage + 1) % CHECKPOINTS.length
    const start = nearestTrackPoint(CHECKPOINTS[stage]).progress
    const end = stage === CHECKPOINTS.length - 1 ? 1 : nearestTrackPoint(CHECKPOINTS[stage + 1]).progress
    return [nextCheckpoint, start + (end - start) * 0.25, start + (end - start) * 0.75] as const
  }))('ranks progress within checkpoint interval ending at %s', (nextCheckpoint, behind, ahead) => {
    const ranked = rankRace([
      entry('behind', { nextCheckpoint, trackProgress: behind }),
      entry('ahead', { nextCheckpoint, trackProgress: ahead }),
    ])
    expect(ranked.map(({ id }) => id)).toEqual(['ahead', 'behind'])
  })

  it.each([
    { checkpointIndex: 1, nextCheckpoint: 2, behindOffset: 0.001, aheadOffset: 0.006 },
    { checkpointIndex: 7, nextCheckpoint: 7, behindOffset: -0.006, aheadOffset: -0.001 },
  ])('ranks real progress around checkpoint $checkpointIndex', ({ checkpointIndex, nextCheckpoint, behindOffset, aheadOffset }) => {
    const boundary = nearestTrackPoint(CHECKPOINTS[checkpointIndex]).progress
    const ranked = rankRace([
      entry('a-behind', { nextCheckpoint, trackProgress: boundary + behindOffset }),
      entry('z-ahead', { nextCheckpoint, trackProgress: boundary + aheadOffset }),
    ])
    expect(ranked.map(({ id }) => id)).toEqual(['z-ahead', 'a-behind'])
  })

  it('keeps the final quarter ahead and orders the start-line seam by completed laps', () => {
    expect(rankRace([
      entry('first-quarter', { nextCheckpoint: 1, trackProgress: 0.1 }),
      entry('last-quarter', { nextCheckpoint: 0, trackProgress: 0.9 }),
    ])[0].id).toBe('last-quarter')
    expect(rankRace([
      entry('before-start', { lap: 0, nextCheckpoint: 0, trackProgress: 0.99 }),
      entry('after-start', { lap: 1, nextCheckpoint: 1, trackProgress: 0.01 }),
    ])[0].id).toBe('after-start')
  })

  it('uses stable ties and always ranks finished racers first', () => {
    expect(rankRace([entry('b'), entry('a')]).map(({ id }) => id)).toEqual(['a', 'b'])
    expect(rankRace([
      entry('racing', { lap: 2, nextCheckpoint: 0, trackProgress: 0.99 }),
      entry('finished', { lap: 3, finishedAt: 1_000, finishPlace: 1 }),
    ])[0].id).toBe('finished')
  })

  it('records authoritative sector and lap timing without starting during countdown', () => {
    const race = createRaceProgress()
    beginRaceTiming(race, 1_000)
    let time = 1_000
    for (const checkpoint of [...CHECKPOINTS.slice(1).map(({ index }) => index), 0]) {
      time += 100
      const crossing = cross(checkpoint)
      updateRaceProgress(race, crossing.previous, crossing.current, time)
    }
    expect(race.raceStartedAt).toBe(1_000)
    expect(race.lastLapTime).toBe(800)
    expect(race.bestLapTime).toBe(800)
    expect(race.bestSectorTimes).toHaveLength(CHECKPOINTS.length)
    expect(race.sectorTimes).toHaveLength(0)
    expect(race.finishedAt).toBeNull()
  })
})
