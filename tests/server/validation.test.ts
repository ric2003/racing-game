import { afterEach, describe, expect, it } from 'vitest'
import { isAllowedOrigin } from '../../server/validation.js'

const originalAllowedOrigins = process.env.ALLOWED_ORIGINS

afterEach(() => {
  if (originalAllowedOrigins === undefined) delete process.env.ALLOWED_ORIGINS
  else process.env.ALLOWED_ORIGINS = originalAllowedOrigins
})

describe('WebSocket origin validation', () => {
  it('allows every origin when origin checks are explicitly disabled', () => {
    process.env.ALLOWED_ORIGINS = '*'

    expect(isAllowedOrigin('http://192.168.1.117:5173')).toBe(true)
    expect(isAllowedOrigin('https://example.test')).toBe(true)
  })
})
