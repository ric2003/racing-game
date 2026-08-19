export type RaceSound = 'countdown' | 'go' | 'pickup' | 'use' | 'boost' | 'hit' | 'spin' | 'finish'

/** Small, asset-free sound layer. It stays silent until the player interacts with the canvas. */
export class RaceAudio {
  private context: AudioContext | null = null
  private muted = false

  resume(): void {
    if (this.muted) return
    const Context = window.AudioContext ?? window.webkitAudioContext
    if (!Context) return
    this.context ??= new Context()
    void this.context.resume()
  }

  setMuted(muted: boolean): void {
    this.muted = muted
  }

  play(sound: RaceSound): void {
    if (this.muted || !this.context || this.context.state !== 'running') return
    const frequencies: Record<RaceSound, [number, number]> = {
      countdown: [220, 0.08],
      go: [660, 0.18],
      pickup: [520, 0.1],
      use: [700, 0.12],
      boost: [880, 0.16],
      hit: [120, 0.18],
      spin: [160, 0.24],
      finish: [740, 0.28],
    }
    const [frequency, duration] = frequencies[sound]
    const oscillator = this.context.createOscillator()
    const gain = this.context.createGain()
    oscillator.type = sound === 'hit' || sound === 'spin' ? 'sawtooth' : 'square'
    oscillator.frequency.setValueAtTime(frequency, this.context.currentTime)
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(60, frequency * 0.7), this.context.currentTime + duration)
    gain.gain.setValueAtTime(0.0001, this.context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.07, this.context.currentTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, this.context.currentTime + duration)
    oscillator.connect(gain)
    gain.connect(this.context.destination)
    oscillator.start()
    oscillator.stop(this.context.currentTime + duration + 0.02)
  }

  dispose(): void {
    void this.context?.close()
    this.context = null
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext
  }
}
