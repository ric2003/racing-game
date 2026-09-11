import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { DEFAULT_TRACK, TRACKS, finishGraceMs, getTrackBounds, getTrackLength, nearestTrackPoint } from '../../src/shared/track.js'
import { createRaceProgress, updateRaceProgress } from '../../src/shared/race.js'
import { stepKart } from '../../src/shared/simulation.js'
import { createTrackMesh } from '../../src/game/track-mesh.js'
import { parseClientMessage } from '../../server/validation.js'

const longTracks = TRACKS.filter((track) => track.theme)

describe('endurance circuits', () => {
  it('adds three circuits and accepts a one-lap race', () => {
    expect(longTracks.map((track) => track.id)).toEqual(['forest-run', 'harbor-grand-prix', 'desert-endurance'])
    expect(parseClientMessage(JSON.stringify({ type: 'update-race-settings', trackId: longTracks[0].id, laps: 1, itemsEnabled: true, mode: 'standard' })).ok).toBe(true)
    expect(finishGraceMs(DEFAULT_TRACK)).toBe(20_000)
  })

  for (const track of longTracks) {
    it(`${track.name} projects nearby and distant positions as accurately as an exhaustive search`, () => {
      for (let sample = 0; sample < 50; sample += 1) {
        const base = track.points[Math.floor(sample * track.points.length / 50)]
        const point = { x: base.x + Math.sin(sample * 1.7) * 500, z: base.z + Math.cos(sample * 2.3) * 500 }
        let bestDistance = Infinity
        for (let index = 0; index < track.points.length; index += 1) {
          const start = track.points[index]
          const end = track.points[(index + 1) % track.points.length]
          const dx = end.x - start.x
          const dz = end.z - start.z
          const fraction = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / (dx * dx + dz * dz)))
          bestDistance = Math.min(bestDistance, Math.hypot(point.x - start.x - dx * fraction, point.z - start.z - dz * fraction))
        }
        expect(nearestTrackPoint(point, track).distance).toBeCloseTo(bestDistance, 8)
      }
    })

    it(`${track.name} is ten times Classic's length with legal starts and regularly spaced pickups`, () => {
      expect(getTrackLength(track) / getTrackLength(DEFAULT_TRACK)).toBeCloseTo(10, 2)
      expect(track.checkpoints).toHaveLength(64)
      expect(track.itemBoxes).toHaveLength(64)
      expect(finishGraceMs(track)).toBe(200_000)
      for (const barrier of track.hazards.filter((hazard) => hazard.type === 'moving-barrier')) {
        for (const boost of track.hazards.filter((hazard) => hazard.type === 'boost-pad')) {
          expect(Math.hypot(barrier.x - boost.x, barrier.z - boost.z)).toBeGreaterThan(20)
        }
      }
      for (const point of [...track.startGrid, ...track.itemBoxes, ...track.hazards]) {
        expect(nearestTrackPoint(point, track).distance).toBeLessThan(7.35)
      }
      const bounds = getTrackBounds(track)
      expect(bounds.maxX - bounds.minX).toBeGreaterThan(500)
      for (let index = 0; index < track.points.length; index += 1) {
        const point = track.points[index]
        const next = track.points[(index + 1) % track.points.length]
        expect(Math.hypot(next.x - point.x, next.z - point.z)).toBeLessThanOrEqual(3.01)
        // Nearby segments form one road; distant sections must not overlap or shortcut.
        for (let other = index + 12; other < track.points.length; other += 1) {
          if (track.points.length - (other - index) < 12) continue
          const separation = Math.hypot(track.points[other].x - point.x, track.points[other].z - point.z)
          if (separation < 19) throw new Error(`Road overlaps near samples ${index} and ${other}`)
        }
      }
    })

    it(`${track.name} can be driven for an ordered, complete lap`, () => {
      const kart = { id: 'driver', ...track.startGrid[0], vx: 0, vz: 0 }
      const progress = createRaceProgress()
      for (let tick = 0; tick < 20_000 && progress.finishedAt === null; tick += 1) {
        const projection = nearestTrackPoint(kart, track)
        const target = track.points[(projection.segmentIndex + 5) % track.points.length]
        const angle = Math.atan2(target.x - kart.x, target.z - kart.z) - kart.heading
        const error = Math.atan2(Math.sin(angle), Math.cos(angle))
        const previous = { x: kart.x, z: kart.z }
        stepKart(kart, { throttle: Math.hypot(kart.vx, kart.vz) < 24 ? 1 : 0, steer: Math.max(-1, Math.min(1, error * 2)), brake: 0 }, 1 / 60, {}, track)
        updateRaceProgress(progress, previous, kart, tick * 1000 / 60, track, 1)
      }
      expect(progress.lap).toBe(1)
      expect(progress.finishedAt).not.toBeNull()
      expect(progress.bestSectorTimes).toHaveLength(64)
    })

    it(`${track.name} keeps curbs in two material draws and scenery near the full route`, () => {
      const visual = createTrackMesh(track)
      try {
        for (const child of visual.group.children.slice(1, 3)) {
          const mesh = child as THREE.Mesh
          expect(Array.isArray(mesh.material)).toBe(false)
          expect(mesh.geometry.groups).toHaveLength(0)
          expect(mesh.geometry.getAttribute('color').count).toBe(mesh.geometry.getAttribute('position').count)
        }
        const scenery: THREE.InstancedMesh[] = []
        visual.group.traverse((child) => {
          if (child instanceof THREE.InstancedMesh) scenery.push(child)
        })
        expect(scenery.reduce((sum, mesh) => sum + mesh.count, 0)).toBeGreaterThan(1000)
        const sectors = new Set<number>()
        const matrix = new THREE.Matrix4()
        const position = new THREE.Vector3()
        for (const mesh of scenery) {
          for (let index = 0; index < mesh.count; index++) {
            mesh.getMatrixAt(index, matrix)
            position.setFromMatrixPosition(matrix)
            const projection = nearestTrackPoint(position, track)
            sectors.add(Math.floor(projection.segmentIndex / track.points.length * 12))
          }
        }
        expect(sectors.size).toBe(12)
        expect(scenery.every((mesh) => mesh.boundingSphere !== null && mesh.boundingSphere.radius < 400)).toBe(true)
      } finally {
        visual.dispose()
      }
    })
  }
})
