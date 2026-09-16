import { readFile } from 'node:fs/promises'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { createMountainBackdrop } from '../../src/game/mountain-backdrop.js'
import { TRACKS, getTrackBounds } from '../../src/shared/track.js'

describe('mountain backdrop', () => {
  let island: THREE.Group
  beforeAll(async () => {
    const bytes = await readFile('public/assets/landmarks/volcano-island.glb')
    const jsonLength = bytes.readUInt32LE(12)
    const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString())
    expect(document.asset.extras.author).toContain('Animateria')
    // Test original geometry/transforms without decoding browser-only textures.
    document.images = []
    document.textures = []
    document.materials = []
    for (const mesh of document.meshes) {
      for (const primitive of mesh.primitives) delete primitive.material
    }
    const json = Buffer.from(JSON.stringify(document))
    const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20)
    json.copy(padded)
    const header = Buffer.from(bytes.subarray(0, 20))
    const binaryChunk = bytes.subarray(20 + jsonLength)
    header.writeUInt32LE(20 + padded.length + binaryChunk.length, 8)
    header.writeUInt32LE(padded.length, 12)
    const geometryOnly = Buffer.concat([header, padded, binaryChunk])
    island = (await new GLTFLoader().parseAsync(geometryOnly.buffer.slice(
      geometryOnly.byteOffset, geometryOnly.byteOffset + geometryOnly.byteLength), '')).scene
    island.getObjectByName('Ocean')?.removeFromParent()
    island.getObjectByName('Clouds')?.removeFromParent()
  })
  afterAll(() => island?.traverse(node => {
    if (node instanceof THREE.Mesh) {
      node.geometry.dispose()
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.dispose()
    }
  }))
  for (const track of TRACKS) {
    it(`fits the imported volcano outside ${track.name} without stretching it`, () => {
      const backdrop = createMountainBackdrop(track, 0xb8d3c6, false)
      try {
        backdrop.setVolcano(island.clone(true))
        const placement = backdrop.group.getObjectByName('volcano-island-placement')!
        const box = new THREE.Box3().setFromObject(placement)
        const bounds = getTrackBounds(track)
        expect(box.max.x < bounds.minX || box.min.x > bounds.maxX ||
          box.max.z < bounds.minZ || box.min.z > bounds.maxZ).toBe(true)
        expect(placement.scale.x).toBe(placement.scale.y)
        expect(placement.scale.y).toBe(placement.scale.z)
        expect(backdrop.group.getObjectByName('procedural-volcano')!.visible).toBe(false)
        const base = placement.getObjectByName('Volcano_Base_Volcano_Base_0') as THREE.Mesh
        const baseBox = new THREE.Box3().setFromObject(base)
        const smoke = backdrop.group.getObjectByName('volcano-smoke-0')!
        expect(Math.abs(smoke.position.y - baseBox.max.y)).toBeLessThan(2)
        const vertices = base.geometry.getAttribute('position')
        let nearestSummit = Infinity
        for (let i = 0; i < vertices.count; i++) {
          const point = new THREE.Vector3().fromBufferAttribute(vertices, i).applyMatrix4(base.matrixWorld)
          if (point.y > baseBox.max.y - 2) nearestSummit = Math.min(nearestSummit, point.distanceTo(smoke.position))
        }
        expect(nearestSummit).toBeLessThan(baseBox.getSize(new THREE.Vector3()).x * 0.08)

        for (const p of track.startGrid) {
          expect(new THREE.Vector3(p.x, 7, p.z).distanceTo(box.getCenter(new THREE.Vector3())) +
            box.getSize(new THREE.Vector3()).length() / 2).toBeLessThan(backdrop.far)
        }
      } finally { backdrop.dispose() }
    })
    it(`keeps ${track.name}'s mountains outside the circuit and within the camera range`, () => {
      const backdrop = createMountainBackdrop(track, 0xb8d3c6, false)
      try {
        const bounds = getTrackBounds(track)
        backdrop.group.updateMatrixWorld(true)
        const mountains: THREE.Object3D[] = []
        backdrop.group.traverse(child => {
          if (child.name === 'green-mountain' || child.name === 'volcano') mountains.push(child)
        })
        for (const mountain of mountains) {
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
      const objects: THREE.Object3D[] = []
      backdrop.group.traverse(child => objects.push(child))
      const before = objects.map(child => child.position.clone())
      backdrop.update(100)
      expect(objects.every((child, i) => child.position.equals(before[i]))).toBe(true)
    } finally { backdrop.dispose() }
  })
})
