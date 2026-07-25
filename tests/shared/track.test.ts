import { describe, expect, it } from 'vitest'
import { TRACK_WIDTH } from '../../src/shared/constants.js'
import {
  CHECKPOINTS,
  legalTrackRadius,
  nearestTrackPoint,
  START_GRID,
  TRACK_POINTS,
  type Point2,
} from '../../src/shared/track.js'

function distance(left: Point2, right: Point2): number {
  return Math.hypot(right.x - left.x, right.z - left.z)
}

function orientation(first: Point2, second: Point2, third: Point2): number {
  return (second.x - first.x) * (third.z - first.z) - (second.z - first.z) * (third.x - first.x)
}

function segmentsCross(first: Point2, second: Point2, third: Point2, fourth: Point2): boolean {
  const firstSide = orientation(first, second, third)
  const secondSide = orientation(first, second, fourth)
  const thirdSide = orientation(third, fourth, first)
  const fourthSide = orientation(third, fourth, second)
  return firstSide * secondSide < 0 && thirdSide * fourthSide < 0
}

function offsetTrack(offset: number): Point2[] {
  return TRACK_POINTS.map((point, index) => {
    const previous = TRACK_POINTS[(index - 1 + TRACK_POINTS.length) % TRACK_POINTS.length]
    const next = TRACK_POINTS[(index + 1) % TRACK_POINTS.length]
    const tangentX = next.x - previous.x
    const tangentZ = next.z - previous.z
    const tangentLength = Math.hypot(tangentX, tangentZ)
    return {
      x: point.x + (tangentZ / tangentLength) * offset,
      z: point.z - (tangentX / tangentLength) * offset,
    }
  })
}

function expectNoSelfIntersections(points: Point2[]): void {
  for (let left = 0; left < points.length; left += 1) {
    const leftNext = (left + 1) % points.length
    for (let right = left + 1; right < points.length; right += 1) {
      const rightNext = (right + 1) % points.length
      const gap = Math.min(right - left, points.length - (right - left))
      if (gap <= 1) continue
      expect(segmentsCross(points[left], points[leftNext], points[right], points[rightNext])).toBe(false)
    }
  }
}

describe('technical track geometry', () => {
  it('is a smooth closed circuit around twice the previous lap length', () => {
    const lengths = TRACK_POINTS.map((point, index) => distance(point, TRACK_POINTS[(index + 1) % TRACK_POINTS.length]))
    const totalLength = lengths.reduce((sum, length) => sum + length, 0)
    expect(TRACK_POINTS).toHaveLength(160)
    expect(totalLength).toBeGreaterThanOrEqual(520)
    expect(totalLength).toBeLessThanOrEqual(545)
    expect(Math.min(...lengths)).toBeGreaterThan(0)
    expect(Math.max(...lengths)).toBeLessThan(6)

    const previous = TRACK_POINTS.at(-1)!
    const current = TRACK_POINTS[0]
    const next = TRACK_POINTS[1]
    const incomingLength = distance(previous, current)
    const outgoingLength = distance(current, next)
    const tangentDot = (
      ((current.x - previous.x) / incomingLength) * ((next.x - current.x) / outgoingLength)
      + ((current.z - previous.z) / incomingLength) * ((next.z - current.z) / outgoingLength)
    )
    expect(tangentDot).toBeGreaterThan(0.98)
  })

  it('does not self-intersect across the centerline or either rendered curb edge', () => {
    expectNoSelfIntersections(TRACK_POINTS)
    const outsideOfCurb = TRACK_WIDTH / 2 + 0.65
    expectNoSelfIntersections(offsetTrack(outsideOfCurb))
    expectNoSelfIntersections(offsetTrack(-outsideOfCurb))
  })

  it('keeps separate road sections farther apart than the rendered track width', () => {
    for (let left = 0; left < TRACK_POINTS.length; left += 1) {
      for (let right = left + 12; right < TRACK_POINTS.length; right += 1) {
        const gap = Math.min(right - left, TRACK_POINTS.length - (right - left))
        if (gap < 12) continue
        expect(distance(TRACK_POINTS[left], TRACK_POINTS[right])).toBeGreaterThan(TRACK_WIDTH + 1)
      }
    }
  })

  it('places eight normalized checkpoints and every kart spawn on the road', () => {
    expect(CHECKPOINTS).toHaveLength(8)
    CHECKPOINTS.forEach((checkpoint, index) => {
      expect(checkpoint.index).toBe(index)
      expect(nearestTrackPoint(checkpoint).distance).toBeLessThan(0.001)
      expect(Math.hypot(checkpoint.normalX, checkpoint.normalZ)).toBeCloseTo(1)
    })
    for (const spawn of START_GRID) {
      expect(nearestTrackPoint(spawn).distance).toBeLessThanOrEqual(legalTrackRadius())
    }
  })
})
