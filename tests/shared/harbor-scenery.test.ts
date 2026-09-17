import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { loadHarborScenery } from '../../src/game/harbor-scenery.js'
import { TRACKS, nearestTrackPoint } from '../../src/shared/track.js'
import { TRACK_WIDTH } from '../../src/shared/constants.js'

afterEach(() => vi.restoreAllMocks())
function geometryLoader() {
  return vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async url => {
    const bytes = await readFile(`public/${url.replace(/^\//, '')}`)
    const length = bytes.readUInt32LE(12)
    const document = JSON.parse(bytes.subarray(20, 20 + length).toString())
    document.images = []; document.textures = []; document.materials = []
    for (const mesh of document.meshes) for (const primitive of mesh.primitives) delete primitive.material
    const json = Buffer.from(JSON.stringify(document))
    const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20)
    json.copy(padded)
    const header = Buffer.from(bytes.subarray(0, 20))
    const binary = bytes.subarray(20 + length)
    header.writeUInt32LE(20 + padded.length + binary.length, 8)
    header.writeUInt32LE(padded.length, 12)
    const combined = Buffer.concat([header, padded, binary])
    return new GLTFLoader().parseAsync(combined.buffer.slice(combined.byteOffset, combined.byteOffset + combined.byteLength), '')
  })
}
describe('map-specific harbor landmarks', () => {
  it('does not download harbor assets for other maps', async () => {
    const loader = geometryLoader()
    for (const track of TRACKS.filter(track => track.theme !== 'harbor')) {
      const scenery = await loadHarborScenery(track)
      expect(scenery.group.children).toHaveLength(0)
      scenery.dispose()
    }
    expect(loader).not.toHaveBeenCalled()
  })
  for (const track of TRACKS.filter(track => track.theme === 'harbor')) {
    it(`loads only the intended assets and clears the road on ${track.name}`, async () => {
      const loader = geometryLoader()
      const scenery = await loadHarborScenery(track)
      try {
        const terminal = track.id === 'neon-harbor'
        expect(loader).toHaveBeenCalledTimes(terminal ? 1 : 3)
        expect(!!scenery.group.getObjectByName('harbor-cruise-liner')).toBe(terminal)
        expect(!!scenery.group.getObjectByName('industrial-yard')).toBe(!terminal)
        scenery.group.updateMatrixWorld(true)
        for (const child of scenery.group.children) {
          const box = new THREE.Box3().setFromObject(child)
          // Sample the complete footprint, including the quay and concrete yards.
          for (let x = box.min.x; x <= box.max.x; x += 4) {
            for (let z = box.min.z; z <= box.max.z; z += 4) {
              expect(nearestTrackPoint({ x, z }, track).distance).toBeGreaterThan(TRACK_WIDTH / 2 + 2)
            }
          }
        }
      } finally { scenery.dispose() }
    })
  }
})
