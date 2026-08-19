import { describe, expect, it } from 'vitest'
import { controlsFromPressed, keyboardTokens, type DrivingBindings } from '../../src/game/keyboard.js'
import { InputScheduler, smoothSteering } from '../../src/game/input-scheduler.js'

const DEFAULT_KEY_BINDINGS: DrivingBindings = {
  accelerate: 'KeyW',
  reverse: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  brake: 'Space',
}

describe('keyboard controls', () => {
  it('recognizes W when a browser omits the physical key code', () => {
    const pressed = new Set(keyboardTokens({ code: '', key: 'w', keyCode: 0 }))

    expect(controlsFromPressed(pressed, { ...DEFAULT_KEY_BINDINGS, accelerate: 'KeyX' }).throttle).toBe(1)
  })

  it('recognizes W from the legacy key number when key and code are unavailable', () => {
    const pressed = new Set(keyboardTokens({ code: '', key: '', keyCode: 87 }))

    expect(controlsFromPressed(pressed, DEFAULT_KEY_BINDINGS).throttle).toBe(1)
  })

  it('keeps W and ArrowUp equivalent and preserves the original A/D directions', () => {
    expect(controlsFromPressed(new Set(['KeyW']), DEFAULT_KEY_BINDINGS).throttle).toBe(1)
    expect(controlsFromPressed(new Set(['ArrowUp']), DEFAULT_KEY_BINDINGS).throttle).toBe(1)
    expect(controlsFromPressed(new Set(['KeyA']), DEFAULT_KEY_BINDINGS).steer).toBe(1)
    expect(controlsFromPressed(new Set(['KeyD']), DEFAULT_KEY_BINDINGS).steer).toBe(-1)
  })

  it.each([59.94, 60, 75, 120, 144])('sends thirty input samples per second at %s Hz', (refreshRate) => {
    const scheduler = new InputScheduler()
    let samples = 0
    for (let frame = 0; frame < refreshRate * 10; frame += 1) samples += scheduler.takeSamples(1 / refreshRate)

    expect(samples).toBeGreaterThanOrEqual(300)
    expect(samples).toBeLessThanOrEqual(301)
  })

  it('smooths digital steering consistently across render rates', () => {
    let at60 = 0
    let at144 = 0
    for (let frame = 0; frame < 5; frame += 1) at60 = smoothSteering(at60, 1, 1 / 60)
    for (let frame = 0; frame < 12; frame += 1) at144 = smoothSteering(at144, 1, 1 / 144)

    expect(at60).toBeCloseTo(at144, 8)
    expect(at60).toBeGreaterThan(0.65)
    expect(at60).toBeLessThan(0.75)
  })
})
