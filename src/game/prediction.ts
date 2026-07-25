import { FIXED_DT, INPUT_INTERVAL } from '../shared/constants.js'
import { cloneKart, stepKart, type KartState } from '../shared/simulation.js'
import type { KartSnapshot, PendingInput } from '../shared/protocol.js'

export class LocalPredictor {
  state: KartState | null = null
  correctionX = 0
  correctionZ = 0
  private accumulator = 0

  reconcile(snapshot: KartSnapshot, pending: PendingInput[]): void {
    const previous = this.state ? cloneKart(this.state) : null
    const authoritative: KartState = {
      id: snapshot.id,
      x: snapshot.x,
      z: snapshot.z,
      heading: snapshot.heading,
      vx: snapshot.vx,
      vz: snapshot.vz,
    }
    for (const input of pending) {
      for (let elapsed = 0; elapsed < INPUT_INTERVAL; elapsed += FIXED_DT) stepKart(authoritative, input)
    }
    this.state = authoritative
    if (previous) {
      const dx = previous.x - authoritative.x
      const dz = previous.z - authoritative.z
      if (Math.hypot(dx, dz) < 5) {
        this.correctionX += dx
        this.correctionZ += dz
      } else {
        this.correctionX = 0
        this.correctionZ = 0
      }
    }
  }

  advance(delta: number, controls: PendingInput): void {
    if (!this.state) return
    this.accumulator += Math.min(delta, 0.1)
    while (this.accumulator >= FIXED_DT) {
      stepKart(this.state, controls)
      this.accumulator -= FIXED_DT
    }
    const decay = Math.exp(-10 * delta)
    this.correctionX *= decay
    this.correctionZ *= decay
  }
}
