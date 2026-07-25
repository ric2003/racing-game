import { describe, expect, it } from 'vitest'
import { SnapshotBuffer } from '../../src/game/interpolation.js'
import { LocalPredictor } from '../../src/game/prediction.js'
import { stepKart, type KartState } from '../../src/shared/simulation.js'
import type { KartSnapshot, PendingInput } from '../../src/shared/protocol.js'
import { START_GRID } from '../../src/shared/track.js'

function snapshot(overrides: Partial<KartSnapshot> = {}): KartSnapshot {
  const start = START_GRID[0]
  return {
    id: 'kart-a',
    name: 'Kart A',
    color: 0xff5d73,
    x: start.x,
    z: start.z,
    heading: start.heading,
    vx: 0,
    vz: 0,
    lap: 0,
    nextCheckpoint: 1,
    finishedAt: null,
    finishPlace: null,
    lastProcessedSeq: -1,
    ...overrides,
  }
}

describe('client prediction and interpolation', () => {
  it('advances remote positions between snapshot arrivals and never extrapolates', () => {
    let clock = 0
    const buffer = new SnapshotBuffer(() => clock)
    for (const [serverTime, x] of [[0, 0], [50, 1], [100, 2], [150, 3]] as const) {
      clock = serverTime
      buffer.push(serverTime, [snapshot({ x })])
    }

    clock = 150
    expect(buffer.sample('kart-a')?.x).toBeCloseTo(1)
    clock = 175
    expect(buffer.sample('kart-a')?.x).toBeCloseTo(1.5)
    clock = 250
    expect(buffer.sample('kart-a')?.x).toBeCloseTo(3)
    clock = 500
    expect(buffer.sample('kart-a')?.x).toBeCloseTo(3)
  })

  it('keeps remote progress monotonic when a delayed snapshot arrives', () => {
    let clock = 0
    const buffer = new SnapshotBuffer(() => clock)
    for (const [serverTime, x] of [[0, 0], [50, 1], [100, 2]] as const) {
      clock = serverTime
      buffer.push(serverTime, [snapshot({ x })])
    }

    clock = 250
    expect(buffer.sample('kart-a')?.x).toBeCloseTo(2)
    clock = 300
    buffer.push(150, [snapshot({ x: 3 })])
    expect(buffer.sample('kart-a')?.x).toBeCloseTo(2)
    clock = 325
    expect(buffer.sample('kart-a')?.x).toBeCloseTo(2)
    clock = 375
    expect(buffer.sample('kart-a')?.x).toBeCloseTo(2.5)
    clock = 500
    expect(buffer.sample('kart-a')?.x).toBeCloseTo(3)
  })

  it('interpolates heading over the shortest turn', () => {
    let clock = 0
    const buffer = new SnapshotBuffer(() => clock)
    buffer.push(0, [snapshot({ heading: 170 * Math.PI / 180 })])
    clock = 100
    buffer.push(100, [snapshot({ heading: -170 * Math.PI / 180 })])
    clock = 150
    const heading = buffer.sample('kart-a')?.heading
    expect(heading).not.toBeNull()
    expect(Math.abs(Math.abs(heading!) - Math.PI)).toBeLessThan(0.001)
  })

  it('replays every unacknowledged input for two fixed steps in order', () => {
    const pending: PendingInput[] = [
      { seq: 1, throttle: 1, steer: 0.25, brake: 0 },
      { seq: 2, throttle: -1, steer: -0.5, brake: 0 },
    ]
    const authoritative = snapshot()
    const expected: KartState = {
      id: authoritative.id,
      x: authoritative.x,
      z: authoritative.z,
      heading: authoritative.heading,
      vx: authoritative.vx,
      vz: authoritative.vz,
    }
    for (const input of pending) {
      stepKart(expected, input)
      stepKart(expected, input)
    }

    const predictor = new LocalPredictor()
    predictor.reconcile(authoritative, pending)
    expect(predictor.state).toEqual(expected)
  })
})
