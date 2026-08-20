import {
  BOOST_ACCELERATION_MULTIPLIER,
  BOOST_MAX_SPEED_MULTIPLIER,
  FIXED_DT,
  INPUT_STEPS_PER_SAMPLE,
} from '../shared/constants.js'
import { NEUTRAL_CONTROLS, type KartSnapshot, type PendingInput } from '../shared/protocol.js'
import { cloneKart, stepKart, type KartState, type StepModifiers } from '../shared/simulation.js'
import { DEFAULT_TRACK, type TrackDefinition } from '../shared/track.js'

const CORRECTION_FREQUENCY = 12

function stepSpring(position: number, velocity: number, delta: number): [position: number, velocity: number] {
  const decay = Math.exp(-CORRECTION_FREQUENCY * delta)
  const offset = (velocity + CORRECTION_FREQUENCY * position) * delta
  return [
    (position + offset) * decay,
    (velocity - CORRECTION_FREQUENCY * offset) * decay,
  ]
}

export class LocalPredictor {
  state: KartState | null = null
  correctionX = 0
  correctionZ = 0
  correctionHeading = 0
  private correctionVelocityX = 0
  private correctionVelocityZ = 0
  private accumulator = 0
  private currentControls: PendingInput = { seq: 0, throttle: 0, steer: 0, brake: 0 }
  private predictedSteps = new Map<number, number>()
  private track: TrackDefinition = DEFAULT_TRACK
  private boostedUntil = 0
  private disabledUntil = 0
  private predictionTime = 0

  get renderState(): KartState | null {
    if (!this.state) return null
    const rendered = cloneKart(this.state)
    if (this.accumulator > 0) this.step(rendered, this.currentControls, this.accumulator, this.predictionTime + this.accumulator * 1_000)
    return rendered
  }

  reconcile(
    snapshot: KartSnapshot,
    pending: PendingInput[],
    track: TrackDefinition = this.track,
    serverTime = this.predictionTime,
  ): void {
    const previous = this.renderState
    this.track = track
    this.boostedUntil = snapshot.boostedUntil ?? 0
    this.disabledUntil = snapshot.disabledUntil ?? snapshot.item?.disabledUntil ?? 0
    let replayTime = serverTime
    const authoritative: KartState = {
      id: snapshot.id,
      x: snapshot.x,
      z: snapshot.z,
      heading: snapshot.heading,
      vx: snapshot.vx,
      vz: snapshot.vz,
    }
    for (const input of pending) {
      const locallyPredicted = this.predictedSteps.get(input.seq) ?? 0
      const reportedRemaining = input.seq === snapshot.processingInputSeq
        ? snapshot.processingInputStepsRemaining ?? INPUT_STEPS_PER_SAMPLE
        : INPUT_STEPS_PER_SAMPLE
      const serverSteps = input.seq === snapshot.processingInputSeq
        ? INPUT_STEPS_PER_SAMPLE - Math.max(0, Math.min(INPUT_STEPS_PER_SAMPLE, Math.floor(reportedRemaining)))
        : 0
      const stepsToReplay = Math.max(0, locallyPredicted - serverSteps)
      for (let step = 0; step < stepsToReplay; step += 1) {
        replayTime += FIXED_DT * 1_000
        this.step(authoritative, input, FIXED_DT, replayTime)
      }
    }
    for (const sequence of this.predictedSteps.keys()) {
      if (sequence <= snapshot.lastProcessedSeq) this.predictedSteps.delete(sequence)
    }
    this.state = authoritative
    this.predictionTime = replayTime
    const reconciled = this.renderState ?? authoritative
    if (previous) {
      const dx = previous.x - reconciled.x
      const dz = previous.z - reconciled.z
      if (Math.hypot(dx, dz) < 5) {
        this.correctionX += dx
        this.correctionZ += dz
        this.correctionVelocityX += previous.vx - reconciled.vx
        this.correctionVelocityZ += previous.vz - reconciled.vz
        const headingDelta = Math.atan2(
          Math.sin(previous.heading - reconciled.heading),
          Math.cos(previous.heading - reconciled.heading),
        )
        this.correctionHeading += headingDelta
      } else {
        this.correctionX = 0
        this.correctionZ = 0
        this.correctionHeading = 0
        this.correctionVelocityX = 0
        this.correctionVelocityZ = 0
      }
    }
  }

  advance(delta: number, controls: PendingInput): void {
    this.currentControls = controls
    if (!this.state) return
    this.accumulator += Math.min(delta, 0.1)
    while (this.accumulator >= FIXED_DT) {
      this.predictionTime += FIXED_DT * 1_000
      this.step(this.state, controls, FIXED_DT, this.predictionTime)
      this.predictedSteps.set(controls.seq, (this.predictedSteps.get(controls.seq) ?? 0) + 1)
      this.accumulator -= FIXED_DT
    }
    ;[this.correctionX, this.correctionVelocityX] = stepSpring(this.correctionX, this.correctionVelocityX, delta)
    ;[this.correctionZ, this.correctionVelocityZ] = stepSpring(this.correctionZ, this.correctionVelocityZ, delta)
    const decay = Math.exp(-10 * delta)
    this.correctionHeading *= decay
  }

  private step(kart: KartState, controls: PendingInput, delta: number, at: number): void {
    const modifiers: StepModifiers = at < this.boostedUntil
      ? { accelerationMultiplier: BOOST_ACCELERATION_MULTIPLIER, maxSpeedMultiplier: BOOST_MAX_SPEED_MULTIPLIER }
      : {}
    stepKart(kart, at < this.disabledUntil ? NEUTRAL_CONTROLS : controls, delta, modifiers, this.track)
  }
}
