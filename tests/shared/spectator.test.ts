import { describe, expect, it } from 'vitest'
import { selectCameraTarget } from '../../src/game/spectator.js'
import type { Standing } from '../../src/shared/protocol.js'

const standings: Standing[] = [
  { id: 'winner', name: 'Winner', lap: 3, place: 1, finished: true },
  { id: 'you', name: 'You', lap: 3, place: 2, finished: true },
  { id: 'out', name: 'Out', lap: 1, place: 3, finished: false, eliminated: true },
  { id: 'racing', name: 'Racing', lap: 2, place: 4, finished: false },
]

describe('spectator camera', () => {
  it('follows an unfinished racer after the local player finishes', () => {
    expect(selectCameraTarget('you', standings)).toBe('racing')
  })

  it('follows an unfinished racer after elimination', () => {
    expect(selectCameraTarget('out', standings)).toBe('racing')
  })

  it('keeps the camera on the player while driving or when nobody is racing', () => {
    expect(selectCameraTarget('racing', standings)).toBe('racing')
    expect(selectCameraTarget('you', standings.filter((standing) => standing.id !== 'racing'))).toBe('you')
    expect(selectCameraTarget('you', [])).toBe('you')
  })
})
