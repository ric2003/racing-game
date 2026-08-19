import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { TRACK_WIDTH } from '../../src/shared/constants.js'
import { createTrackMesh } from '../../src/game/track-mesh.js'
import {
  CHECKPOINTS,
  legalTrackRadius,
  nearestTrackPoint,
  START_GRID,
  TRACK_POINTS,
  TRACKS,
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
  it('is a smooth, flowing closed circuit', () => {
    const lengths = TRACK_POINTS.map((point, index) => distance(point, TRACK_POINTS[(index + 1) % TRACK_POINTS.length]))
    const totalLength = lengths.reduce((sum, length) => sum + length, 0)
    expect(TRACK_POINTS).toHaveLength(150)
    expect(totalLength).toBeGreaterThanOrEqual(440)
    expect(totalLength).toBeLessThanOrEqual(460)
    expect(Math.min(...lengths)).toBeGreaterThan(0)
    expect(Math.max(...lengths)).toBeLessThan(4)

    const tangentDots = TRACK_POINTS.map((point, index) => {
      const previous = TRACK_POINTS[(index - 1 + TRACK_POINTS.length) % TRACK_POINTS.length]
      const next = TRACK_POINTS[(index + 1) % TRACK_POINTS.length]
      const incomingLength = distance(previous, point)
      const outgoingLength = distance(point, next)
      return (
        ((point.x - previous.x) / incomingLength) * ((next.x - point.x) / outgoingLength)
        + ((point.z - previous.z) / incomingLength) * ((next.z - point.z) / outgoingLength)
      )
    })
    expect(Math.min(...tangentDots)).toBeGreaterThan(0.995)

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

  it('does not self-intersect across the centerline', () => {
    expectNoSelfIntersections(TRACK_POINTS)
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
    const visual = createTrackMesh()
    try {
      const road = visual.group.children[0] as THREE.Mesh<THREE.BufferGeometry>
      visual.group.updateMatrixWorld(true)
      for (const spawn of START_GRID) {
        expect(nearestTrackPoint(spawn).distance).toBeLessThanOrEqual(legalTrackRadius())
        const ray = new THREE.Raycaster(
          new THREE.Vector3(spawn.x, 10, spawn.z),
          new THREE.Vector3(0, -1, 0),
        )
        expect(ray.intersectObject(road)).toHaveLength(1)
      }
    } finally {
      visual.dispose()
    }
  })

  it('batches bounded road and curb triangles without cross-track geometry', () => {
    const visual = createTrackMesh()
    try {
      const surfaceMeshes = visual.group.children.slice(0, 3)
      expect(surfaceMeshes).toHaveLength(3)
      surfaceMeshes.forEach((object, meshIndex) => {
        const position = (object as THREE.Mesh<THREE.BufferGeometry>).geometry.getAttribute('position')
        const values = position.array
        expect(position.count).toBe(TRACK_POINTS.length * 12)
        let maximumEdge = 0
        let maximumJoinEdge = 0
        for (let offset = 0; offset < values.length; offset += 9) {
          for (const [left, right] of [[0, 3], [3, 6], [6, 0]] as const) {
            const edge = Math.hypot(
              values[offset + left] - values[offset + right],
              values[offset + left + 1] - values[offset + right + 1],
              values[offset + left + 2] - values[offset + right + 2],
            )
            maximumEdge = Math.max(maximumEdge, edge)
            if (offset % 36 >= 18) maximumJoinEdge = Math.max(maximumJoinEdge, edge)
          }
        }
        expect(maximumEdge).toBeLessThan(meshIndex === 0 ? TRACK_WIDTH + 1 : 7)
        expect(maximumJoinEdge).toBeLessThan(meshIndex === 0 ? TRACK_WIDTH / 2 + 1 : 7)
      })
    } finally {
      visual.dispose()
    }
  })

  it('exposes three versioned circuits with valid starts, checkpoints, item boxes, and hazards', () => {
    expect(TRACKS.map((track) => track.id)).toEqual(['neon-classic', 'neon-harbor', 'skyway-switchbacks'])
    for (const track of TRACKS) {
      expect(track.version).toBe(2)
      expect(track.points).toHaveLength(150)
      expect(track.checkpoints).toHaveLength(8)
      expect(track.startGrid).toHaveLength(4)
      expect(track.itemBoxes).toHaveLength(8)
      expect(track.hazards.length).toBeGreaterThan(0)
      expectNoSelfIntersections(track.points)
      for (const spawn of track.startGrid) expect(nearestTrackPoint(spawn, track).distance).toBeLessThanOrEqual(legalTrackRadius() + 0.001)
      for (const item of track.itemBoxes) expect(nearestTrackPoint(item, track).distance).toBeLessThanOrEqual(legalTrackRadius())
      for (const hazard of track.hazards) expect(nearestTrackPoint(hazard, track).distance).toBeLessThanOrEqual(legalTrackRadius())
    }
  })
})
