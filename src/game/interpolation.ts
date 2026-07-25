import { INTERPOLATION_DELAY_MS } from '../shared/constants.js'
import type { KartSnapshot } from '../shared/protocol.js'

interface Frame {
  time: number
  karts: KartSnapshot[]
}

export class SnapshotBuffer {
  private frames: Frame[] = []
  private latestArrivalTime = 0
  private lastTargetTime = -Infinity
  private readonly now: () => number

  constructor(now: () => number = () => performance.now()) {
    this.now = now
  }

  push(serverTime: number, karts: KartSnapshot[]): void {
    if (this.frames.at(-1)?.time === serverTime) return
    this.frames.push({ time: serverTime, karts })
    this.latestArrivalTime = this.now()
    if (this.frames.length > 30) this.frames.shift()
  }

  sample(id: string): KartSnapshot | null {
    if (this.frames.length === 0) return null
    const latestServerTime = this.frames[this.frames.length - 1].time
    const estimatedServerTime = latestServerTime + Math.max(0, this.now() - this.latestArrivalTime)
    const target = Math.min(latestServerTime, Math.max(this.lastTargetTime, estimatedServerTime - INTERPOLATION_DELAY_MS))
    this.lastTargetTime = target
    let before = this.frames[0]
    let after = this.frames[this.frames.length - 1]
    for (let index = 1; index < this.frames.length; index += 1) {
      if (this.frames[index].time >= target) {
        before = this.frames[index - 1]
        after = this.frames[index]
        break
      }
    }
    const from = before.karts.find((kart) => kart.id === id)
    const to = after.karts.find((kart) => kart.id === id) ?? from
    if (!from || !to) return null
    const span = Math.max(1, after.time - before.time)
    const amount = Math.max(0, Math.min(1, (target - before.time) / span))
    const headingDelta = Math.atan2(Math.sin(to.heading - from.heading), Math.cos(to.heading - from.heading))
    return {
      ...to,
      x: from.x + (to.x - from.x) * amount,
      z: from.z + (to.z - from.z) * amount,
      vx: from.vx + (to.vx - from.vx) * amount,
      vz: from.vz + (to.vz - from.vz) * amount,
      heading: from.heading + headingDelta * amount,
    }
  }
}
