import { INPUT_INTERVAL } from '../shared/constants.js'

const MAX_SAMPLES_PER_FRAME = 3

export class InputScheduler {
  private elapsed = INPUT_INTERVAL

  takeSamples(delta: number): number {
    this.elapsed += Math.max(0, Math.min(0.1, delta))
    const available = Math.floor((this.elapsed + 1e-9) / INPUT_INTERVAL)
    const samples = Math.min(MAX_SAMPLES_PER_FRAME, available)
    this.elapsed -= samples * INPUT_INTERVAL
    if (available > MAX_SAMPLES_PER_FRAME) this.elapsed %= INPUT_INTERVAL
    return samples
  }
}

export function smoothSteering(current: number, target: number, delta: number): number {
  const response = target === 0 ? 18 : 14
  const amount = 1 - Math.exp(-response * Math.max(0, Math.min(0.1, delta)))
  const next = current + (target - current) * amount
  return Math.abs(next) < 0.0001 ? 0 : next
}
