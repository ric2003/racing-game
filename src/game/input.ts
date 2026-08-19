import type { Controls } from '../shared/protocol.js'
import { controlsFromPressed, keyboardTokens } from './keyboard.js'

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
const DRIVING_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', ...ARROW_KEYS])
const DRIVING_KEY_VALUES = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'])
const DRIVING_KEY_CODES = new Set([38, 40, 37, 39, 65, 68, 83, 87])
const KEY_BINDINGS_EVENT = 'neon-apex-key-bindings-changed'

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
  window.dispatchEvent(new Event(KEY_BINDINGS_EVENT))
}

export interface InputController {
  read: () => Controls
  consumeItem: () => boolean
  dispose: () => void
}

export function createInputController(element: HTMLElement, onReset: () => void): InputController {
  const pressed = new Set<string>()
  let bindings = loadKeyBindings()
  let itemQueued = false
  let gamepadItemPressed = false
  const refreshBindings = () => { bindings = loadKeyBindings() }
  const onKeyDown = (event: KeyboardEvent) => {
    if (isTypingTarget(event.target)) return
    const keyValue = event.key.toLowerCase()
    if (DRIVING_KEYS.has(event.code) || DRIVING_KEY_VALUES.has(keyValue) || DRIVING_KEY_CODES.has(event.keyCode) || Object.values(bindings).includes(event.code)) event.preventDefault()
    element.focus({ preventScroll: true })
    if (event.code === bindings.reset && !event.repeat) onReset()
    if (event.code === bindings.item && !event.repeat) itemQueued = true
    for (const token of keyboardTokens(event)) pressed.add(token)
  }
  const onKeyUp = (event: KeyboardEvent) => {
    for (const token of keyboardTokens(event)) pressed.delete(token)
  }
  const onBlur = () => {
    pressed.clear()
    itemQueued = false
    gamepadItemPressed = false
  }
  const onPointerDown = () => element.focus()
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('keyup', onKeyUp, true)
  window.addEventListener('blur', onBlur)
  window.addEventListener('storage', refreshBindings)
  window.addEventListener(KEY_BINDINGS_EVENT, refreshBindings)
  element.addEventListener('pointerdown', onPointerDown)
  return {
    read: () => controlsFromPressed(pressed, bindings, gamepadAxis(0), gamepadAxis(1), gamepadButton(0)),
    consumeItem: () => {
      const currentGamepadItem = gamepadButton(2)
      const queued = itemQueued || (currentGamepadItem && !gamepadItemPressed)
      gamepadItemPressed = currentGamepadItem
      itemQueued = false
      return queued
    },
    dispose: () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('storage', refreshBindings)
      window.removeEventListener(KEY_BINDINGS_EVENT, refreshBindings)
      element.removeEventListener('pointerdown', onPointerDown)
    },
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.matches('input, textarea, select')
}

function gamepadAxis(index: number): number {
  const gamepad = navigator.getGamepads?.()[0]
  if (!gamepad) return 0
  const value = gamepad.axes[index] ?? 0
  return Math.abs(value) < 0.18 ? 0 : value
}

function gamepadButton(index: number): boolean {
  return Boolean(navigator.getGamepads?.()[0]?.buttons[index]?.pressed)
}
