import { MAX_MESSAGE_BYTES } from '../src/shared/constants.js'
import type { ClientMessage, LapCount, RaceMode } from '../src/shared/protocol.js'

const NAME_PATTERN = /^[A-Za-z0-9 _-]{2,16}$/
const ROOM_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/
const allowedFields: Record<ClientMessage['type'], string[]> = {
  'create-room': ['type', 'name'],
  'join-room': ['type', 'name', 'roomCode'],
  'resume-room': ['type', 'name', 'roomCode', 'token'],
  'start-race': ['type'],
  'update-race-settings': ['type', 'trackId', 'laps', 'itemsEnabled', 'mode'],
  'cast-track-vote': ['type', 'trackId'],
  'request-rematch': ['type'],
  'quick-reaction': ['type', 'reaction'],
  input: ['type', 'seq', 'throttle', 'steer', 'brake', 'useItem'],
  reset: ['type'],
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactFields(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === expected.length && keys.every((key) => expected.includes(key))
}

export type ParseResult = { ok: true; message: ClientMessage } | { ok: false; code: string; message: string }

export function parseClientMessage(payload: string | Buffer): ParseResult {
  const bytes = typeof payload === 'string' ? Buffer.byteLength(payload) : payload.byteLength
  if (bytes > MAX_MESSAGE_BYTES) return { ok: false, code: 'payload-too-large', message: 'Message is too large.' }
  let value: unknown
  try {
    value = JSON.parse(payload.toString())
  } catch {
    return { ok: false, code: 'invalid-json', message: 'Message must be valid JSON.' }
  }
  if (!isPlainObject(value) || typeof value.type !== 'string' || !Object.hasOwn(allowedFields, value.type)) {
    return { ok: false, code: 'invalid-message', message: 'Unknown message type.' }
  }
  const type = value.type as ClientMessage['type']
  const inputFieldsValid = type === 'input'
    ? hasExactFields(value, allowedFields.input) || hasExactFields(value, allowedFields.input.filter((field) => field !== 'useItem'))
    : hasExactFields(value, allowedFields[type])
  if (!inputFieldsValid) return { ok: false, code: 'invalid-fields', message: 'Message fields are invalid.' }

  if (type === 'create-room') {
    if (typeof value.name !== 'string' || !NAME_PATTERN.test(value.name.trim())) return { ok: false, code: 'invalid-name', message: 'Name must be 2 to 16 letters or numbers.' }
    return { ok: true, message: { type, name: value.name.trim() } }
  }
  if (type === 'join-room') {
    if (typeof value.name !== 'string' || !NAME_PATTERN.test(value.name.trim())) return { ok: false, code: 'invalid-name', message: 'Name must be 2 to 16 letters or numbers.' }
    if (typeof value.roomCode !== 'string' || !ROOM_PATTERN.test(value.roomCode.toUpperCase())) return { ok: false, code: 'invalid-room', message: 'Room code is invalid.' }
    return { ok: true, message: { type, name: value.name.trim(), roomCode: value.roomCode.toUpperCase() } }
  }
  if (type === 'resume-room') {
    if (typeof value.name !== 'string' || !NAME_PATTERN.test(value.name.trim())) return { ok: false, code: 'invalid-name', message: 'Name must be 2 to 16 letters or numbers.' }
    if (typeof value.roomCode !== 'string' || !ROOM_PATTERN.test(value.roomCode.toUpperCase())) return { ok: false, code: 'invalid-room', message: 'Room code is invalid.' }
    if (typeof value.token !== 'string' || value.token.length < 16 || value.token.length > 128) return { ok: false, code: 'invalid-token', message: 'Reconnect token is invalid.' }
    return { ok: true, message: { type, name: value.name.trim(), roomCode: value.roomCode.toUpperCase(), token: value.token } }
  }
  if (type === 'start-race' || type === 'request-rematch' || type === 'reset') return { ok: true, message: { type } }
  if (type === 'quick-reaction') {
    if (value.reaction !== 'nice' && value.reaction !== 'oops' && value.reaction !== 'rematch') return { ok: false, code: 'invalid-reaction', message: 'Reaction is invalid.' }
    return { ok: true, message: { type, reaction: value.reaction } }
  }
  if (type === 'cast-track-vote') {
    if (typeof value.trackId !== 'string' || value.trackId.length < 3 || value.trackId.length > 64) return { ok: false, code: 'invalid-track', message: 'Track is invalid.' }
    return { ok: true, message: { type, trackId: value.trackId } }
  }
  if (type === 'update-race-settings') {
    if (typeof value.trackId !== 'string' || value.trackId.length < 3 || value.trackId.length > 64) return { ok: false, code: 'invalid-track', message: 'Track is invalid.' }
    if (value.laps !== 2 && value.laps !== 3 && value.laps !== 5) return { ok: false, code: 'invalid-settings', message: 'Lap count is invalid.' }
    if (typeof value.itemsEnabled !== 'boolean' || (value.mode !== 'standard' && value.mode !== 'knockout')) return { ok: false, code: 'invalid-settings', message: 'Race settings are invalid.' }
    return { ok: true, message: { type, trackId: value.trackId, laps: value.laps as LapCount, itemsEnabled: value.itemsEnabled, mode: value.mode as RaceMode } }
  }

  if (typeof value.seq !== 'number' || typeof value.throttle !== 'number' || typeof value.steer !== 'number' || typeof value.brake !== 'number') {
    return { ok: false, code: 'invalid-controls', message: 'Controls must be finite numbers.' }
  }
  const { seq, throttle, steer, brake } = value
  if (![seq, throttle, steer, brake].every(Number.isFinite)) return { ok: false, code: 'invalid-controls', message: 'Controls must be finite numbers.' }
  if (!Number.isSafeInteger(seq) || seq < 0 || seq > 1_000_000_000) return { ok: false, code: 'invalid-sequence', message: 'Input sequence is invalid.' }
  if (Math.abs(throttle) > 1 || Math.abs(steer) > 1 || brake < 0 || brake > 1) return { ok: false, code: 'invalid-controls', message: 'Controls are out of range.' }
  if ('useItem' in value && typeof value.useItem !== 'boolean') return { ok: false, code: 'invalid-controls', message: 'Item action must be boolean.' }
  return { ok: true, message: { type: 'input', seq, throttle, steer, brake, useItem: value.useItem === true } }
}

export function isAllowedOrigin(origin: string | undefined, configured = process.env.ALLOWED_ORIGINS): boolean {
  if (!origin) return true
  if (configured) {
    const allowedOrigins = configured.split(',').map((item) => item.trim())
    if (allowedOrigins.includes('*')) return true
    return allowedOrigins.includes(origin)
  }
  try {
    const url = new URL(origin)
    return (url.hostname === 'localhost' || url.hostname === '127.0.0.1') && (url.protocol === 'http:' || url.protocol === 'https:')
  } catch {
    return false
  }
}
