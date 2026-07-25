import { describe, expect, it } from 'vitest'
import { createRaceProgress, rankRace, updateRaceProgress, type RaceEntry } from '../../src/shared/race.js'
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
      for (const checkpoint of [1, 2, 3, 0]) {
        const crossing = cross(checkpoint)
        updateRaceProgress(race, crossing.previous, crossing.current, time += 100)
      }
      expect(race.lap).toBe(lap + 1)
    }
    expect(race.finishedAt).toBe(time)
    expect(race.nextCheckpoint).toBe(1)
  })

  it.each([
    [1, 0.05, 0.2],
    [2, 0.3, 0.45],
    [3, 0.55, 0.7],
    [0, 0.8, 0.95],
  ])('ranks progress within checkpoint interval %s', (nextCheckpoint, behind, ahead) => {
    const ranked = rankRace([
      entry('behind', { nextCheckpoint, trackProgress: behind }),
      entry('ahead', { nextCheckpoint, trackProgress: ahead }),
    ])
    expect(ranked.map(({ id }) => id)).toEqual(['ahead', 'behind'])
  })

  it.each([
    { checkpointIndex: 1, nextCheckpoint: 2, behindOffset: 0.001, aheadOffset: 0.006 },
    { checkpointIndex: 3, nextCheckpoint: 3, behindOffset: -0.006, aheadOffset: -0.001 },
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
})
