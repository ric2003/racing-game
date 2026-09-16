import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createMountainBackdrop } from '../../src/game/mountain-backdrop.js'
import { TRACKS, getTrackBounds } from '../../src/shared/track.js'

describe('mountain backdrop', () => {
  for (const track of TRACKS) {
    it(`keeps ${track.name}'s mountains outside the circuit and within the camera range`, () => {
      const backdrop = createMountainBackdrop(track, 0xb8d3c6, false)
      try {
        const bounds = getTrackBounds(track)
        backdrop.group.updateMatrixWorld(true)
        for (const mountain of backdrop.group.children.filter(child =>
          child.name === 'green-mountain' || child.name === 'volcano')) {
          const box = new THREE.Box3().setFromObject(mountain)
          expect(box.max.x < bounds.minX || box.min.x > bounds.maxX ||
            box.max.z < bounds.minZ || box.min.z > bounds.maxZ).toBe(true)
          for (const x of [bounds.minX, bounds.maxX]) {
            for (const z of [bounds.minZ, bounds.maxZ]) {
              expect(new THREE.Vector3(x, 7, z).distanceTo(box.getCenter(new THREE.Vector3())) +
                box.getSize(new THREE.Vector3()).length() / 2).toBeLessThan(backdrop.far)
            }
          }
        }
        const smoke = backdrop.group.getObjectByName('volcano-smoke-3')!
        const before = smoke.position.clone()
        backdrop.update(5)
        expect(smoke.position.y).toBeGreaterThan(before.y)
        expect(backdrop.group.getObjectByName('glowing-crater')).toBeDefined()
      } finally { backdrop.dispose() }
    })
  }
  it('holds the smoke and lava steady with reduced motion', () => {
    const backdrop = createMountainBackdrop(TRACKS[0], 0xb8d3c6, true)
    try {
      const before = backdrop.group.children.map(child => child.position.clone())
      backdrop.update(100)
      expect(backdrop.group.children.every((child, i) => child.position.equals(before[i]))).toBe(true)
    } finally { backdrop.dispose() }
  })
})
