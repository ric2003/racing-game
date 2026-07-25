import type { Controls } from '../shared/protocol.js'

const DRIVE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'])

export interface InputController {
  read: () => Controls
  dispose: () => void
}

export function createInputController(element: HTMLElement, onReset: () => void): InputController {
  const pressed = new Set<string>()
  const onKeyDown = (event: KeyboardEvent) => {
    if (document.activeElement !== element) return
    if (DRIVE_KEYS.has(event.code)) event.preventDefault()
    if (event.code === 'KeyR' && !event.repeat) onReset()
    pressed.add(event.code)
  }
  const onKeyUp = (event: KeyboardEvent) => pressed.delete(event.code)
  const onBlur = () => pressed.clear()
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  return {
    read: () => ({
      throttle: (pressed.has('KeyW') || pressed.has('ArrowUp') ? 1 : 0) - (pressed.has('KeyS') || pressed.has('ArrowDown') ? 1 : 0),
      steer: (pressed.has('KeyA') || pressed.has('ArrowLeft') ? 1 : 0) - (pressed.has('KeyD') || pressed.has('ArrowRight') ? 1 : 0),
      brake: pressed.has('Space') ? 1 : 0,
    }),
    dispose: () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    },
  }
}
