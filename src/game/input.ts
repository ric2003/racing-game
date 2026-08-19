import type { Controls } from '../shared/protocol.js'

export type BindingAction = 'accelerate' | 'reverse' | 'left' | 'right' | 'brake' | 'item' | 'reset'

export interface KeyBindings {
  accelerate: string
  reverse: string
  left: string
  right: string
  brake: string
  item: string
  reset: string
}

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  accelerate: 'KeyW',
  reverse: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  brake: 'Space',
  item: 'KeyE',
  reset: 'KeyR',
}

const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

export function loadKeyBindings(): KeyBindings {
  try {
    const parsed = JSON.parse(localStorage.getItem('neon-apex-key-bindings') ?? '{}') as Partial<KeyBindings>
    return { ...DEFAULT_KEY_BINDINGS, ...Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === 'string' && value.length > 0)) }
  } catch {
    return { ...DEFAULT_KEY_BINDINGS }
  }
}

export function saveKeyBindings(bindings: KeyBindings): void {
  localStorage.setItem('neon-apex-key-bindings', JSON.stringify(bindings))
}

export interface InputController {
  read: () => Controls
  consumeItem: () => boolean
  dispose: () => void
}

export function createInputController(element: HTMLElement, onReset: () => void): InputController {
  const pressed = new Set<string>()
  let itemQueued = false
  let gamepadItemPressed = false
  const onKeyDown = (event: KeyboardEvent) => {
    if (document.activeElement !== element) return
    const bindings = loadKeyBindings()
    if (ARROW_KEYS.has(event.code) || Object.values(bindings).includes(event.code)) event.preventDefault()
    if (event.code === bindings.reset && !event.repeat) onReset()
    if (event.code === bindings.item && !event.repeat) itemQueued = true
    pressed.add(event.code)
  }
  const onKeyUp = (event: KeyboardEvent) => pressed.delete(event.code)
  const onBlur = () => {
    pressed.clear()
    itemQueued = false
    gamepadItemPressed = false
  }
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  return {
    read: () => ({
      throttle: Math.max(-1, Math.min(1, (pressed.has(loadKeyBindings().accelerate) || pressed.has('ArrowUp') ? 1 : 0) - (pressed.has(loadKeyBindings().reverse) || pressed.has('ArrowDown') ? 1 : 0) + gamepadAxis(1))),
      steer: Math.max(-1, Math.min(1, (pressed.has(loadKeyBindings().left) || pressed.has('ArrowLeft') ? 1 : 0) - (pressed.has(loadKeyBindings().right) || pressed.has('ArrowRight') ? 1 : 0) + gamepadAxis(0))),
      brake: pressed.has(loadKeyBindings().brake) || gamepadButton(0) ? 1 : 0,
    }),
    consumeItem: () => {
      const currentGamepadItem = gamepadButton(2)
      const queued = itemQueued || (currentGamepadItem && !gamepadItemPressed)
      gamepadItemPressed = currentGamepadItem
      itemQueued = false
      return queued
    },
    dispose: () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    },
  }
}

function gamepadAxis(index: number): number {
  const gamepad = navigator.getGamepads?.()[0]
  if (!gamepad) return 0
  const value = gamepad.axes[index] ?? 0
  return Math.abs(value) < 0.18 ? 0 : -value
}

function gamepadButton(index: number): boolean {
  return Boolean(navigator.getGamepads?.()[0]?.buttons[index]?.pressed)
}
