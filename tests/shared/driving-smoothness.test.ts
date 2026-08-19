import { describe, expect, it } from 'vitest'
import { LocalPredictor } from '../../src/game/prediction.js'
import { FIXED_DT, INPUT_STEPS_PER_SAMPLE } from '../../src/shared/constants.js'
import type { KartSnapshot, PendingInput } from '../../src/shared/protocol.js'
import { stepKart, type KartState } from '../../src/shared/simulation.js'
import { START_GRID } from '../../src/shared/track.js'

const CLOCK_HZ = 7_200
const PHYSICS_TICKS = FIXED_DT * CLOCK_HZ
const INPUT_TICKS = CLOCK_HZ / 30
const SNAPSHOT_TICKS = CLOCK_HZ / 20
const NETWORK_DELAY_TICKS = CLOCK_HZ / 20
const RUN_TICKS = CLOCK_HZ * 2
const RENDER_RATES = [60, 120, 144] as const

interface QueuedInput extends PendingInput {
  stepsRemaining: number
}

interface RenderSample {
  tick: number
  x: number
  z: number
  heading: number
  correction: number
}

interface DeliveredSnapshot {
  tick: number
  snapshot: KartSnapshot
}

function makeSnapshot(state: KartState, lastProcessedSeq: number, queue: QueuedInput[]): KartSnapshot {
  return {
    id: state.id,
    name: 'Smoothness test kart',
    color: 0xff5d73,
    x: state.x,
    z: state.z,
    heading: state.heading,
    vx: state.vx,
    vz: state.vz,
    lap: 0,
    nextCheckpoint: 1,
    finishedAt: null,
    finishPlace: null,
    lastProcessedSeq,
    processingInputSeq: queue[0]?.seq ?? null,
    processingInputStepsRemaining: queue[0]?.stepsRemaining ?? 0,
  }
}

function addDelivery<T>(deliveries: Map<number, T[]>, tick: number, value: T): void {
  const scheduled = deliveries.get(tick) ?? []
  scheduled.push(value)
  deliveries.set(tick, scheduled)
}

function simulate(renderRate: typeof RENDER_RATES[number]): RenderSample[] {
  const renderTicks = CLOCK_HZ / renderRate
  const grid = START_GRID[0]
  const serverState: KartState = {
    id: 'local-kart',
    x: grid.x,
    z: grid.z,
    heading: grid.heading,
    vx: 0,
    vz: 0,
  }
  const predictor = new LocalPredictor()
  const serverQueue: QueuedInput[] = []
  const inputDeliveries = new Map<number, PendingInput[]>()
  const snapshotDeliveries = new Map<number, DeliveredSnapshot[]>()
  const samples: RenderSample[] = []
  let serverControls: PendingInput = { seq: 0, throttle: 0, steer: 0, brake: 0 }
  let clientControls: PendingInput = { seq: 0, throttle: 1, steer: 0, brake: 0 }
  let pending: PendingInput[] = []
  let sequence = 0
  let lastProcessedSeq = -1

  predictor.reconcile(makeSnapshot(serverState, lastProcessedSeq, serverQueue), pending)

  for (let tick = 0; tick <= RUN_TICKS; tick += 1) {
    for (const input of inputDeliveries.get(tick) ?? []) {
      serverQueue.push({ ...input, stepsRemaining: INPUT_STEPS_PER_SAMPLE })
    }

    if (tick > 0 && tick % PHYSICS_TICKS === 0) {
      const queued = serverQueue[0]
      if (queued) {
        serverControls = queued
        queued.stepsRemaining -= 1
        if (queued.stepsRemaining === 0) {
          lastProcessedSeq = queued.seq
          serverQueue.shift()
        }
      }
      stepKart(serverState, serverControls)

      if (tick % SNAPSHOT_TICKS === 0) {
        const deliveryTick = tick + NETWORK_DELAY_TICKS
        addDelivery(snapshotDeliveries, deliveryTick, {
          tick: deliveryTick,
          snapshot: makeSnapshot(serverState, lastProcessedSeq, serverQueue),
        })
      }
    }

    for (const delivery of snapshotDeliveries.get(tick) ?? []) {
      pending = pending.filter((input) => input.seq > delivery.snapshot.lastProcessedSeq)
      predictor.reconcile(delivery.snapshot, pending)
    }

    if (tick % INPUT_TICKS === 0) {
      clientControls = { seq: sequence += 1, throttle: 1, steer: 0, brake: 0 }
      pending.push(clientControls)
      addDelivery(inputDeliveries, tick + NETWORK_DELAY_TICKS, clientControls)
    }

    if (tick > 0 && tick % renderTicks === 0) {
      predictor.advance(renderTicks / CLOCK_HZ, clientControls)
      const rendered = predictor.renderState
      if (!rendered) throw new Error('Predictor did not have an initialized state.')
      samples.push({
        tick,
        x: rendered.x + predictor.correctionX,
        z: rendered.z + predictor.correctionZ,
        heading: rendered.heading + predictor.correctionHeading,
        correction: Math.hypot(predictor.correctionX, predictor.correctionZ),
      })
    }
  }

  return samples
}

function motionMetrics(samples: RenderSample[]) {
  const speeds: number[] = []
  let backwardFrames = 0
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1]
    const current = samples[index]
    const elapsed = (current.tick - previous.tick) / CLOCK_HZ
    const dx = current.x - previous.x
    const dz = current.z - previous.z
    speeds.push(Math.hypot(dx, dz) / elapsed)
    const forwardProgress = dx * Math.sin(previous.heading) + dz * Math.cos(previous.heading)
    if (forwardProgress < -0.000_001) backwardFrames += 1
  }
  const speedJumps = speeds.slice(1).map((speed, index) => Math.abs(speed - speeds[index]))
  return {
    backwardFrames,
    maxCorrection: Math.max(...samples.map((sample) => sample.correction)),
    maxSpeedJump: Math.max(...speedJumps),
  }
}

function sampleAt(samples: RenderSample[], tick: number): RenderSample {
  const exact = samples.find((sample) => sample.tick === tick)
  if (exact) return exact
  const afterIndex = samples.findIndex((sample) => sample.tick > tick)
  if (afterIndex <= 0) throw new Error(`No render samples surround clock tick ${tick}.`)
  const before = samples[afterIndex - 1]
  const after = samples[afterIndex]
  const amount = (tick - before.tick) / (after.tick - before.tick)
  const headingDelta = Math.atan2(Math.sin(after.heading - before.heading), Math.cos(after.heading - before.heading))
  return {
    tick,
    x: before.x + (after.x - before.x) * amount,
    z: before.z + (after.z - before.z) * amount,
    heading: before.heading + headingDelta * amount,
    correction: before.correction + (after.correction - before.correction) * amount,
  }
}

describe('local driving smoothness', () => {
  it('stays smooth and render-rate independent with 20 Hz server snapshots', () => {
    const runs = new Map(RENDER_RATES.map((rate) => [rate, simulate(rate)]))

    for (const rate of RENDER_RATES) {
      const metrics = motionMetrics(runs.get(rate)!)
      expect.soft(metrics.backwardFrames, `${rate} Hz rendered a backward frame while accelerating`).toBe(0)
      expect.soft(metrics.maxCorrection, `${rate} Hz accumulated a visible reconciliation correction`).toBeLessThan(0.08)
      expect.soft(metrics.maxSpeedJump, `${rate} Hz produced a one-frame speed spike`).toBeLessThan(1.5)
    }

    const baseline = runs.get(60)!
    for (const rate of [120, 144] as const) {
      const candidate = runs.get(rate)!
      let maxPositionDifference = 0
      for (const expected of baseline) {
        const actual = sampleAt(candidate, expected.tick)
        maxPositionDifference = Math.max(maxPositionDifference, Math.hypot(actual.x - expected.x, actual.z - expected.z))
      }
      expect.soft(maxPositionDifference, `60 Hz and ${rate} Hz disagreed at the same presentation time`).toBeLessThan(0.03)
    }
  })
})
