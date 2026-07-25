import { describe, expect, it } from 'vitest'
import { FIXED_DT, HANDLING, KART_RADIUS } from '../../src/shared/constants.js'
import { resolveKartCollisions, stepKart, type KartState } from '../../src/shared/simulation.js'
import { legalTrackRadius, nearestTrackPoint, START_GRID } from '../../src/shared/track.js'

function kart(id = 'a'): KartState {
  const start = START_GRID[0]
  return { id, x: start.x, z: start.z, heading: start.heading, vx: 0, vz: 0 }
}

const neutral = { throttle: 0, steer: 0, brake: 0 }

function expectSeparated(karts: KartState[], epsilon = 0.002): void {
  for (let left = 0; left < karts.length; left += 1) {
    for (let right = left + 1; right < karts.length; right += 1) {
      expect(Math.hypot(karts[right].x - karts[left].x, karts[right].z - karts[left].z)).toBeGreaterThanOrEqual(KART_RADIUS * 2 - epsilon)
    }
  }
}

describe('arcade simulation', () => {
  it('accelerates, coasts with drag, and brakes', () => {
    const state = kart()
    for (let index = 0; index < 120; index += 1) stepKart(state, { ...neutral, throttle: 1 })
    const movingSpeed = Math.hypot(state.vx, state.vz)
    expect(movingSpeed).toBeGreaterThan(10)
    expect(movingSpeed).toBeLessThanOrEqual(HANDLING.maxForwardSpeed + 1e-9)
    for (let index = 0; index < 30; index += 1) stepKart(state, neutral)
    expect(Math.hypot(state.vx, state.vz)).toBeLessThan(movingSpeed)
    for (let index = 0; index < 60; index += 1) stepKart(state, { ...neutral, brake: 1 })
    expect(Math.hypot(state.vx, state.vz)).toBeLessThan(1)
  })

  it('bounds reverse speed and turns only while moving', () => {
    const state = kart()
    stepKart(state, { ...neutral, steer: 1 })
    expect(state.heading).toBe(START_GRID[0].heading)
    for (let index = 0; index < 240; index += 1) stepKart(state, { ...neutral, throttle: -1 })
    expect(Math.hypot(state.vx, state.vz)).toBeLessThanOrEqual(HANDLING.maxReverseSpeed + 0.01)
    const heading = state.heading
    for (let index = 0; index < 20; index += 1) stepKart(state, { throttle: -1, steer: 1, brake: 0 })
    expect(state.heading).not.toBe(heading)
  })

  it('constrains escaped karts to the legal road edge', () => {
    const state = kart()
    state.x = 120
    state.z = 80
    state.vx = 20
    state.vz = 10
    stepKart(state, neutral, FIXED_DT)
    expect(nearestTrackPoint(state).distance).toBeLessThanOrEqual(legalTrackRadius() + 0.001)
  })

  it('separates overlapping karts deterministically', () => {
    const left = kart('a')
    const right = { ...kart('b'), x: left.x, z: left.z }
    resolveKartCollisions([left, right])
    expectSeparated([left, right])
  })

  it('separates three and four kart pileups, including at the track edge', () => {
    const centerPile = ['a', 'b', 'c', 'd'].map((id) => kart(id))
    resolveKartCollisions(centerPile)
    expectSeparated(centerPile)

    const projection = nearestTrackPoint(START_GRID[0])
    const sideX = projection.tangentZ
    const sideZ = -projection.tangentX
    const edgePile = ['a', 'b', 'c', 'd'].map((id) => ({
      ...kart(id),
      x: projection.x + sideX * legalTrackRadius(),
      z: projection.z + sideZ * legalTrackRadius(),
    }))
    resolveKartCollisions(edgePile)
    expectSeparated(edgePile)
    for (const state of edgePile) expect(nearestTrackPoint(state).distance).toBeLessThanOrEqual(legalTrackRadius() + 0.001)
  })

  it('converges a concentrated four-kart pile near the track edge in one bounded solve', () => {
    const edgePile: KartState[] = [
      { id: 'a', x: 9.101718427985906, z: -30.961520813126118, heading: 0, vx: 0, vz: 0 },
      { id: 'b', x: 9.140667195804417, z: -31.76376770688221, heading: 0, vx: 0, vz: 0 },
      { id: 'c', x: 9.129837837442755, z: -31.501494651380927, heading: 0, vx: 0, vz: 0 },
      { id: 'd', x: 9.187546109221875, z: -32.6404115117155, heading: 0, vx: 0, vz: 0 },
    ]

    resolveKartCollisions(edgePile)
    expectSeparated(edgePile, 0.0002)
    for (const state of edgePile) expect(nearestTrackPoint(state).distance).toBeLessThanOrEqual(legalTrackRadius() + 0.001)
  })

  it('repeats the same fixed-step input exactly', () => {
    const first = kart()
    const second = kart()
    for (let index = 0; index < 180; index += 1) {
      const controls = { throttle: index < 130 ? 1 : 0, steer: Math.sin(index / 20), brake: index > 160 ? 1 : 0 }
      stepKart(first, controls)
      stepKart(second, controls)
    }
    expect(second).toEqual(first)
  })
})
