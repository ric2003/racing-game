import { FIXED_DT, HANDLING, KART_RADIUS } from './constants.js'
import type { Controls } from './protocol.js'
import { legalTrackRadius, nearestTrackPoint } from './track.js'

export interface KartState {
  id: string
  x: number
  z: number
  heading: number
  vx: number
  vz: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function stepKart(kart: KartState, controls: Controls, dt = FIXED_DT): void {
  const throttle = clamp(controls.throttle, -1, 1)
  const steer = clamp(controls.steer, -1, 1)
  const brake = clamp(controls.brake, 0, 1)
  const forwardX = Math.sin(kart.heading)
  const forwardZ = Math.cos(kart.heading)
  const rightX = Math.cos(kart.heading)
  const rightZ = -Math.sin(kart.heading)
  let forwardSpeed = kart.vx * forwardX + kart.vz * forwardZ
  let lateralSpeed = kart.vx * rightX + kart.vz * rightZ

  const acceleration = throttle >= 0 ? HANDLING.acceleration : HANDLING.reverseAcceleration
  forwardSpeed += throttle * acceleration * dt
  if (brake > 0 && Math.abs(forwardSpeed) > 0.05) {
    const brakeDelta = HANDLING.brakeForce * brake * dt
    forwardSpeed = Math.sign(forwardSpeed) * Math.max(0, Math.abs(forwardSpeed) - brakeDelta)
  }
  const drag = (HANDLING.rollingDrag + Math.abs(forwardSpeed) * HANDLING.aerodynamicDrag) * dt
  forwardSpeed = Math.sign(forwardSpeed) * Math.max(0, Math.abs(forwardSpeed) - drag)
  forwardSpeed = clamp(forwardSpeed, -HANDLING.maxReverseSpeed, HANDLING.maxForwardSpeed)
  lateralSpeed *= Math.max(0, 1 - HANDLING.lateralGrip * dt)

  const steeringStrength = Math.min(1, Math.abs(forwardSpeed) / 5)
  const reverseDirection = forwardSpeed < 0 ? -0.65 : 1
  kart.heading += steer * HANDLING.steeringRate * steeringStrength * reverseDirection * dt

  const nextForwardX = Math.sin(kart.heading)
  const nextForwardZ = Math.cos(kart.heading)
  const nextRightX = Math.cos(kart.heading)
  const nextRightZ = -Math.sin(kart.heading)
  kart.vx = nextForwardX * forwardSpeed + nextRightX * lateralSpeed
  kart.vz = nextForwardZ * forwardSpeed + nextRightZ * lateralSpeed
  kart.x += kart.vx * dt
  kart.z += kart.vz * dt
  constrainToTrack(kart)
}

export function constrainToTrack(kart: KartState): void {
  const nearest = nearestTrackPoint(kart)
  const legal = legalTrackRadius()
  if (nearest.distance <= legal) return
  const dx = kart.x - nearest.x
  const dz = kart.z - nearest.z
  const length = Math.max(0.0001, Math.hypot(dx, dz))
  kart.x = nearest.x + (dx / length) * legal
  kart.z = nearest.z + (dz / length) * legal
  const outwardSpeed = kart.vx * (dx / length) + kart.vz * (dz / length)
  if (outwardSpeed > 0) {
    kart.vx -= (dx / length) * outwardSpeed * 1.35
    kart.vz -= (dz / length) * outwardSpeed * 1.35
  }
  kart.vx *= 0.72
  kart.vz *= 0.72
}

const MAX_COLLISION_ITERATIONS = 80
const COLLISION_EPSILON = 0.0001

function stablePairNormal(leftId: string, rightId: string): { x: number; z: number } {
  let hash = 2_166_136_261
  for (const character of `${leftId}:${rightId}`) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16_777_619)
  }
  const angle = ((hash >>> 0) / 0x1_0000_0000) * Math.PI * 2
  return { x: Math.cos(angle), z: Math.sin(angle) }
}

function hasCollisionOverlap(karts: KartState[], minimumDistance: number): boolean {
  for (let left = 0; left < karts.length; left += 1) {
    for (let right = left + 1; right < karts.length; right += 1) {
      if (Math.hypot(karts[right].x - karts[left].x, karts[right].z - karts[left].z) < minimumDistance - COLLISION_EPSILON) return true
    }
  }
  return false
}

export function resolveKartCollisions(karts: KartState[]): void {
  const ordered = [...karts].sort((left, right) => left.id.localeCompare(right.id))
  const minimumDistance = KART_RADIUS * 2
  for (let iteration = 0; iteration < MAX_COLLISION_ITERATIONS; iteration += 1) {
    let foundOverlap = false
    for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
        const left = ordered[leftIndex]
        const right = ordered[rightIndex]
        const dx = right.x - left.x
        const dz = right.z - left.z
        const distance = Math.hypot(dx, dz)
        if (distance >= minimumDistance - COLLISION_EPSILON) continue
        foundOverlap = true
        const fallback = stablePairNormal(left.id, right.id)
        const normalX = distance < COLLISION_EPSILON ? fallback.x : dx / distance
        const normalZ = distance < COLLISION_EPSILON ? fallback.z : dz / distance
        const overlap = minimumDistance - distance
        left.x -= normalX * overlap * 0.5
        left.z -= normalZ * overlap * 0.5
        right.x += normalX * overlap * 0.5
        right.z += normalZ * overlap * 0.5
        if (iteration === 0) {
          const relative = (right.vx - left.vx) * normalX + (right.vz - left.vz) * normalZ
          if (relative < 0) {
            const impulse = Math.min(8, -relative * 0.65)
            left.vx -= normalX * impulse
            left.vz -= normalZ * impulse
            right.vx += normalX * impulse
            right.vz += normalZ * impulse
          }
        }
      }
    }
    if (!foundOverlap) break
    for (const kart of ordered) constrainToTrack(kart)
    if (!hasCollisionOverlap(ordered, minimumDistance)) break
  }
}

export function cloneKart(kart: KartState): KartState {
  return { ...kart }
}
