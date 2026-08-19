import type { Controls } from '../shared/protocol.js'

export interface DrivingBindings {
  accelerate: string
  reverse: string
  left: string
  right: string
  brake: string
}

interface KeyboardLike {
  code: string
  key: string
  keyCode: number
}

export function keyboardTokens(event: KeyboardLike): string[] {
  const tokens: string[] = []
  if (event.code) tokens.push(event.code)
  if (event.key) tokens.push(`key:${event.key.toLowerCase()}`)
  if (event.keyCode > 0) tokens.push(`keyCode:${event.keyCode}`)
  return tokens
}

export function controlsFromPressed(pressed: ReadonlySet<string>, bindings: DrivingBindings, gamepadX = 0, gamepadY = 0, gamepadBrake = false): Controls {
  const has = (...tokens: string[]) => tokens.some((token) => pressed.has(token))
  const forward = has(bindings.accelerate, 'KeyW', 'key:w', 'keyCode:87', 'ArrowUp', 'key:arrowup', 'keyCode:38')
  const reverse = has(bindings.reverse, 'KeyS', 'key:s', 'keyCode:83', 'ArrowDown', 'key:arrowdown', 'keyCode:40')
  const left = has(bindings.left, 'KeyA', 'key:a', 'keyCode:65', 'ArrowLeft', 'key:arrowleft', 'keyCode:37')
  const right = has(bindings.right, 'KeyD', 'key:d', 'keyCode:68', 'ArrowRight', 'key:arrowright', 'keyCode:39')
  return {
    throttle: clampAxis((forward ? 1 : 0) - (reverse ? 1 : 0) - gamepadY),
    steer: clampAxis((left ? 1 : 0) - (right ? 1 : 0) - gamepadX),
    brake: has(bindings.brake, 'Space', 'key: ', 'keyCode:32') || gamepadBrake ? 1 : 0,
  }
}

function clampAxis(value: number): number {
  return Math.max(-1, Math.min(1, value))
}
