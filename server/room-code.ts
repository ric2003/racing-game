import { randomInt, randomUUID } from 'node:crypto'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function createRoomCode(existing: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = ''
    for (let index = 0; index < 6; index += 1) code += ALPHABET[randomInt(ALPHABET.length)]
    if (!existing.has(code)) return code
  }
  throw new Error('Could not allocate a room code')
}

export function createPlayerId(): string {
  return randomUUID()
}
