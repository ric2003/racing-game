import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bindingConflict, createInputController, DEFAULT_KEY_BINDINGS } from '../../src/game/input.js'

class TestElement extends EventTarget {
  focus = vi.fn()
  matches = () => false
  isContentEditable = false
}

function key(type: string, code: string) {
  window.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), {
    code, key: code.replace('Key', '').toLowerCase(), keyCode: 0, repeat: false,
  }))
}

describe('input while editing controls', () => {
  beforeEach(() => {
    vi.stubGlobal('window', new EventTarget())
    vi.stubGlobal('HTMLElement', TestElement)
    vi.stubGlobal('localStorage', { getItem: () => null })
    vi.stubGlobal('navigator', { getGamepads: () => [] })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('does not drive, reset, use items, or steal focus while controls are open', () => {
    const canvas = new TestElement()
    const reset = vi.fn()
    const input = createInputController(canvas as unknown as HTMLElement, reset, () => false)
    try {
      key('keydown', 'KeyW')
      key('keydown', 'KeyR')
      key('keydown', 'KeyE')
      expect(input.read()).toEqual({ throttle: 0, steer: 0, brake: 0 })
      expect(input.consumeItem()).toBe(false)
      expect(reset).not.toHaveBeenCalled()
      expect(canvas.focus).not.toHaveBeenCalled()
    } finally {
      input.dispose()
    }
  })

  it('clears held controls and queued items before returning to driving', () => {
    let enabled = true
    const input = createInputController(new TestElement() as unknown as HTMLElement, vi.fn(), () => enabled)
    try {
      key('keydown', 'KeyW')
      key('keydown', 'KeyE')
      expect(input.read().throttle).toBe(1)
      enabled = false
      expect(input.read().throttle).toBe(0)
      enabled = true
      expect(input.read().throttle).toBe(0)
      expect(input.consumeItem()).toBe(false)
      key('keydown', 'KeyW')
      expect(input.read().throttle).toBe(1)
    } finally {
      input.dispose()
    }
  })

  it('suspends gamepad input while the controls dialog is open', () => {
    vi.stubGlobal('navigator', { getGamepads: () => [{
      axes: [1, -1], buttons: [{ pressed: true }, { pressed: false }, { pressed: true }],
    }] })
    const input = createInputController(new TestElement() as unknown as HTMLElement, vi.fn(), () => false)
    try {
      expect(input.read()).toEqual({ throttle: 0, steer: 0, brake: 0 })
      expect(input.consumeItem()).toBe(false)
    } finally {
      input.dispose()
    }
  })
})

describe('binding conflicts', () => {
  it('rejects a key assigned to another action', () => {
    expect(bindingConflict(DEFAULT_KEY_BINDINGS, 'item', 'KeyR')).toBe('reset')
    expect(bindingConflict({ ...DEFAULT_KEY_BINDINGS, brake: 'KeyB' }, 'reset', 'KeyB')).toBe('brake')
  })

  it('protects fallback driving keys after the primary control is rebound', () => {
    const bindings = { ...DEFAULT_KEY_BINDINGS, accelerate: 'KeyX', brake: 'KeyB' }
    expect(bindingConflict(bindings, 'item', 'KeyW')).toBe('accelerate')
    expect(bindingConflict(bindings, 'item', 'ArrowUp')).toBe('accelerate')
    expect(bindingConflict(bindings, 'reset', 'Space')).toBe('brake')
  })

  it('accepts unused keys and the action’s own bindings', () => {
    expect(bindingConflict(DEFAULT_KEY_BINDINGS, 'item', 'KeyQ')).toBeNull()
    expect(bindingConflict(DEFAULT_KEY_BINDINGS, 'accelerate', 'ArrowUp')).toBeNull()
    expect(bindingConflict(DEFAULT_KEY_BINDINGS, 'reset', 'KeyR')).toBeNull()
  })
})
