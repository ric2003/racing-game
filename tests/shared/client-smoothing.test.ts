import { describe, expect, it } from 'vitest'
import { SnapshotBuffer } from '../../src/game/interpolation.js'
import { LocalPredictor } from '../../src/game/prediction.js'
import { FIXED_DT } from '../../src/shared/constants.js'
import { stepKart, type KartState } from '../../src/shared/simulation.js'
import type { KartSnapshot, PendingInput } from '../../src/shared/protocol.js'
import { legalTrackRadius, nearestTrackPoint, START_GRID, TRACKS } from '../../src/shared/track.js'

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
    predictor.reconcile(authoritative, [])
    for (const input of pending) {
      predictor.advance(FIXED_DT, input)
      predictor.advance(FIXED_DT, input)
    }
    predictor.reconcile(authoritative, pending)
    expect(predictor.state).toEqual(expected)
  })

  it('replays only the unfinished half of an input already started by the server', () => {
    const first: PendingInput = { seq: 1, throttle: 1, steer: 0.5, brake: 0 }
    const second: PendingInput = { seq: 2, throttle: 1, steer: 0, brake: 0 }
    const authoritative = snapshot({ processingInputSeq: first.seq, processingInputStepsRemaining: 1 })
    const expected: KartState = {
      id: authoritative.id,
      x: authoritative.x,
      z: authoritative.z,
      heading: authoritative.heading,
      vx: authoritative.vx,
      vz: authoritative.vz,
    }
    stepKart(expected, first)
    stepKart(expected, second)
    stepKart(expected, second)

    const predictor = new LocalPredictor()
    predictor.reconcile(snapshot(), [])
    predictor.advance(FIXED_DT, first)
    predictor.advance(FIXED_DT, first)
    predictor.advance(FIXED_DT, second)
    predictor.advance(FIXED_DT, second)
    predictor.reconcile(authoritative, [first, second])

    expect(predictor.state).toEqual(expected)
  })

  it('keeps the rendered heading continuous across server reconciliation', () => {
    const predictor = new LocalPredictor()
    predictor.reconcile(snapshot({ heading: 0 }), [])
    predictor.state!.heading = 0.4
    const renderedBefore = predictor.state!.heading + predictor.correctionHeading

    predictor.reconcile(snapshot({ heading: 0.2 }), [])

    expect(predictor.state!.heading + predictor.correctionHeading).toBeCloseTo(renderedBefore)
    predictor.advance(0.1, { seq: 1, throttle: 0, steer: 0, brake: 0 })
    expect(Math.abs(predictor.correctionHeading)).toBeLessThan(0.2)
  })

  it('renders motion between fixed physics steps', () => {
    const predictor = new LocalPredictor()
    predictor.reconcile(snapshot({ vx: 12 }), [])
    const physicsX = predictor.state!.x

    predictor.advance(FIXED_DT / 2, { seq: 1, throttle: 0, steer: 0, brake: 0 })

    expect(predictor.state!.x).toBe(physicsX)
    expect(predictor.renderState!.x).toBeGreaterThan(physicsX)
  })

  it('uses the selected track for local road boundaries', () => {
    const track = TRACKS[1]
    const point = track.points.reduce((furthest, candidate) => (
      nearestTrackPoint(candidate).distance > nearestTrackPoint(furthest).distance ? candidate : furthest
    ))
    expect(nearestTrackPoint(point).distance).toBeGreaterThan(legalTrackRadius())
    const predictor = new LocalPredictor()
    predictor.reconcile(snapshot({ x: point.x, z: point.z }), [], track)

    predictor.advance(FIXED_DT, { seq: 1, throttle: 0, steer: 0, brake: 0 })

    expect(predictor.state!.x).toBeCloseTo(point.x)
    expect(predictor.state!.z).toBeCloseTo(point.z)
    expect(nearestTrackPoint(predictor.state!, track).distance).toBeLessThan(0.001)
  })

  it('predicts active turbo and disabled movement modifiers', () => {
    const controls: PendingInput = { seq: 1, throttle: 1, steer: 0, brake: 0 }
    const normal = new LocalPredictor()
    normal.reconcile(snapshot(), [], undefined, 0)
    normal.advance(FIXED_DT, controls)

    const boosted = new LocalPredictor()
    boosted.reconcile(snapshot({ boostedUntil: 1_000 }), [], undefined, 0)
    boosted.advance(FIXED_DT, controls)
    expect(Math.hypot(boosted.state!.vx, boosted.state!.vz)).toBeGreaterThan(Math.hypot(normal.state!.vx, normal.state!.vz))

    const disabled = new LocalPredictor()
    disabled.reconcile(snapshot({ disabledUntil: 1_000 }), [], undefined, 0)
    disabled.advance(FIXED_DT, controls)
    expect(Math.hypot(disabled.state!.vx, disabled.state!.vz)).toBe(0)
  })

  it('keeps the full displayed pose continuous through reconciliation', () => {
    const predictor = new LocalPredictor()
    const controls: PendingInput = { seq: 1, throttle: 1, steer: 0.5, brake: 0 }
    predictor.reconcile(snapshot({ vx: 8, vz: 2 }), [])
    predictor.advance(FIXED_DT * 1.5, controls)
    const before = predictor.renderState!
    const displayedBefore = {
      x: before.x + predictor.correctionX,
      z: before.z + predictor.correctionZ,
      heading: before.heading + predictor.correctionHeading,
    }

    predictor.reconcile(snapshot({ x: before.x - 0.4, z: before.z + 0.25, heading: before.heading - 0.2, vx: 6, vz: 1 }), [controls])
    const after = predictor.renderState!

    expect(after.x + predictor.correctionX).toBeCloseTo(displayedBefore.x, 10)
    expect(after.z + predictor.correctionZ).toBeCloseTo(displayedBefore.z, 10)
    expect(after.heading + predictor.correctionHeading).toBeCloseTo(displayedBefore.heading, 10)
  })
})
