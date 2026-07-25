import { describe, expect, it } from 'vitest'
import { parseClientMessage } from '../../server/validation.js'

describe('client protocol validation', () => {
  it('accepts a bounded input', () => {
    const result = parseClientMessage(JSON.stringify({ type: 'input', seq: 1, throttle: 1, steer: -0.5, brake: 0 }))
    expect(result.ok).toBe(true)
  })

  it.each([
    ['malformed JSON', '{'],
    ['unknown message', JSON.stringify({ type: 'teleport', x: 1 })],
    ['extra fields', JSON.stringify({ type: 'start-race', host: true })],
    ['invalid name', JSON.stringify({ type: 'create-room', name: '<script>' })],
    ['non-finite controls', '{"type":"input","seq":1,"throttle":1e999,"steer":0,"brake":0}'],
    ['out of range controls', JSON.stringify({ type: 'input', seq: 1, throttle: 2, steer: 0, brake: 0 })],
  ])('rejects %s', (_, payload) => {
    expect(parseClientMessage(payload).ok).toBe(false)
  })

  it.each(['constructor', 'hasOwnProperty', '__proto__'])('rejects inherited protocol type %s without throwing', (type) => {
    expect(() => parseClientMessage(JSON.stringify({ type }))).not.toThrow()
    expect(parseClientMessage(JSON.stringify({ type })).ok).toBe(false)
  })

  it('rejects an oversized payload', () => {
    expect(parseClientMessage(Buffer.alloc(1_025, 97)).ok).toBe(false)
  })
})
