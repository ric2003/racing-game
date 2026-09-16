import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { ModelLibrary, RACING_MODELS } from '../../src/game/models.js'
import { createKartMesh } from '../../src/game/kart-mesh.js'
import { createTrackMesh } from '../../src/game/track-mesh.js'
import { TRACK_WIDTH } from '../../src/shared/constants.js'
import { nearestTrackPoint, TRACKS } from '../../src/shared/track.js'

describe('Blender model integration', () => {
  const models = new ModelLibrary()
  beforeAll(async () => {
    const loader = new GLTFLoader()
    for (const id of ['race-car', ...RACING_MODELS] as const) {
      const bytes = await readFile(`public/assets/${id === 'race-car' ? 'cars' : 'racing'}/${id}.glb`)
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      const gltf = await loader.parseAsync(buffer, '')
      models.add(id, gltf.scene)
    }
  })
  afterAll(() => models.dispose())

  it('exports a car without studio objects, with four centered rotating wheels and independent paint', () => {
    const first = createKartMesh(0xff5d73, models)
    const second = createKartMesh(0x57d9ff, models)
    try {
      expect(first.wheels).toHaveLength(4)
      const car = first.group.getObjectByName('blender-car')!
      const bounds = new THREE.Box3().setFromObject(car)
      expect(bounds.max.z - bounds.min.z).toBeGreaterThan(4)
      expect(bounds.max.z - bounds.min.z).toBeLessThan(5)
      expect(bounds.max.x - bounds.min.x).toBeLessThan(2.6)
      expect(bounds.min.y).toBeGreaterThanOrEqual(-0.05)
      expect(first.wheels.find(wheel => wheel.name === 'wheel_front_left')!.position.z)
        .toBeGreaterThan(first.wheels.find(wheel => wheel.name === 'wheel_rear_left')!.position.z)
      for (const wheel of first.wheels) {
        const center = new THREE.Box3().setFromObject(wheel).getCenter(new THREE.Vector3())
        const pivot = wheel.getWorldPosition(new THREE.Vector3())
        expect(center.distanceTo(pivot)).toBeLessThan(0.1)
      }
      function paint(visual: typeof first) {
        const paints: THREE.MeshStandardMaterial[] = []
        visual.group.traverse(node => {
          if (!(node instanceof THREE.Mesh)) return
          for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
            if (material instanceof THREE.MeshStandardMaterial && material.name.includes('Papaya orange enamel')) paints.push(material)
          }
        })
        return paints
      }
      expect(paint(first).length).toBeGreaterThan(0)
      expect(paint(first).every(material => material.color.getHex() === 0xff5d73)).toBe(true)
      expect(paint(second).every(material => material.color.getHex() === 0x57d9ff)).toBe(true)
    } finally {
      first.dispose()
      second.dispose()
    }
  })

  it('smooths snapshot steps between frames while keeping the cable taut', () => {
    const track = TRACKS[0]
    const hazard = track.hazards.find(hazard => hazard.type === 'moving-barrier')!
    const projection = nearestTrackPoint(hazard, track)
    function run(fps: number) {
      const visual = createTrackMesh(track, models)
      try {
        const root = visual.group.getObjectByName(`hazard-${hazard.id}`)!
        const ball = root.getObjectByName('suspended-cannonball')!
        const pivot = root.getObjectByName('pendulum-pivot')!
        expect(root.getObjectByName('Oops, who left this here?')).toBeDefined()
        const initial = { id: hazard.id, type: hazard.type, x: projection.x, z: projection.z, active: true }
        visual.update(0, 0, [], [initial], [])
        const target = { ...initial, x: projection.x + projection.tangentZ * 4.5, z: projection.z - projection.tangentX * 4.5 }
        let previous = 0
        for (let frame = 1; frame <= fps / 2; frame++) {
          // Only one new snapshot; animation must continue on subsequent frames.
          visual.update(frame / fps, 50, undefined, frame === 1 ? [target] : undefined, undefined)
          visual.group.updateMatrixWorld(true)
          const center = ball.getWorldPosition(new THREE.Vector3())
          const anchor = pivot.getWorldPosition(new THREE.Vector3())
          expect(center.distanceTo(anchor)).toBeCloseTo(Math.abs(ball.position.y))
          const offset = (center.x - projection.x) * projection.tangentZ - (center.z - projection.z) * projection.tangentX
          expect(offset).toBeGreaterThan(previous)
          expect(offset).toBeLessThan(4.5)
          if (frame === 1) expect(offset).toBeLessThan(3)
          previous = offset
        }
        expect(previous).toBeCloseTo(4.5, 2)
        return pivot.quaternion.clone()
      } finally { visual.dispose() }
    }
    expect(run(30).angleTo(run(120))).toBeLessThan(0.000001)
  })

  for (const useModels of [false, true]) {
    for (const track of TRACKS) {
      it(`suspends ${track.name} hazards from clear supports with ${useModels ? 'Blender' : 'fallback'} balls`, () => {
        const visual = createTrackMesh(track, useModels ? models : undefined)
        try {
          for (const hazard of track.hazards.filter(hazard => hazard.type === 'moving-barrier')) {
            const root = visual.group.getObjectByName(`hazard-${hazard.id}`)!
            const ball = root.getObjectByName('suspended-cannonball')!
            const pivot = root.getObjectByName('pendulum-pivot')!
            const cable = root.getObjectByName('suspension-cable')!
            const projection = nearestTrackPoint(hazard, track)
            const fixedPosition = root.position.clone()
            const length = Math.abs(ball.position.y)
            let lowHeight = 0
            for (const offset of [0, 4.5, -4.5, 0]) {
              const x = projection.x + projection.tangentZ * offset
              const z = projection.z - projection.tangentX * offset
              visual.update(0, 1000, [], [{ id: hazard.id, type: hazard.type, x, z, active: true }], [])
              visual.group.updateMatrixWorld(true)
              const center = ball.getWorldPosition(new THREE.Vector3())
              const anchor = pivot.getWorldPosition(new THREE.Vector3())
              expect(center.x).toBeCloseTo(x)
              expect(center.z).toBeCloseTo(z)
              expect(center.distanceTo(anchor)).toBeCloseTo(length)
              expect(root.position.equals(fixedPosition)).toBe(true)
              expect(center.y - hazard.radius).toBeGreaterThan(0.1)
              if (offset === 0) lowHeight = center.y
              else expect(center.y).toBeGreaterThan(lowHeight)
              const cableTop = new THREE.Vector3(0, 0.5, 0).applyMatrix4(cable.matrixWorld)
              const cableBottom = new THREE.Vector3(0, -0.5, 0).applyMatrix4(cable.matrixWorld)
              expect(cableTop.distanceTo(anchor)).toBeLessThan(0.0001)
              expect(cableBottom.distanceTo(center)).toBeCloseTo(hazard.radius)
            }
            for (const foot of root.children.filter(child => child.name === 'gantry-foot')) {
              // Each 3 m square foundation is clear of every part of the circuit.
              const world = foot.getWorldPosition(new THREE.Vector3())
              expect(nearestTrackPoint(world, track).distance - Math.hypot(1.5, 1.5)).toBeGreaterThan(TRACK_WIDTH / 2)
            }
            const crossbeam = root.getObjectByName('gantry-crossbeam')!
            expect(new THREE.Box3().setFromObject(crossbeam).min.y).toBeGreaterThan(10)
          }
        } finally { visual.dispose() }
      })
    }
  }

  for (const track of TRACKS) {
    it(`${track.name} points chevrons into bends and boost arrows along travel`, () => {
      const visual = createTrackMesh(track, models)
      let signs = 0
      try {
        visual.group.updateMatrixWorld(true)
        visual.group.traverse(node => {
          if (!(node instanceof THREE.InstancedMesh) || !node.name.startsWith('chevron_board_')) return
          if (!(node.material instanceof THREE.MeshStandardMaterial) || node.material.name !== 'graphite') return
          // Read the actual arrow tips from the exported face, not the filename.
          const positions = node.geometry.getAttribute('position')
          let sum = 0
          let count = 0
          for (let i = 0; i < positions.count; i++) {
            if (Math.abs(positions.getY(i) - 2) < 0.001 && Math.abs(positions.getZ(i) - 0.079) < 0.001) {
              sum += positions.getX(i)
              count++
            }
          }
          expect(count).toBeGreaterThan(0)
          const arrowSign = Math.sign(sum / count)
          for (let i = 0; i < node.count; i++) {
            const matrix = new THREE.Matrix4()
            node.getMatrixAt(i, matrix)
            const point = new THREE.Vector3().setFromMatrixPosition(matrix)
            const projection = nearestTrackPoint(point, track)
            const ahead = track.points[(projection.segmentIndex + 8) % track.points.length]
            const heading = Math.atan2(projection.tangentX, projection.tangentZ)
            const turn = Math.sin(Math.atan2(ahead.x - projection.x, ahead.z - projection.z) - heading)
            if (Math.abs(turn) < 0.03) continue
            const arrow = new THREE.Vector3(arrowSign, 0, 0).transformDirection(matrix)
            const intoBend = new THREE.Vector3(projection.tangentZ, 0, -projection.tangentX).multiplyScalar(Math.sign(turn))
            expect(arrow.dot(intoBend)).toBeGreaterThan(0.8)
            signs++
          }
        })
        expect(signs).toBeGreaterThan(0)
        for (const hazard of track.hazards.filter(hazard => hazard.type === 'boost-pad')) {
          const pad = visual.group.getObjectByName(`hazard-${hazard.id}`)!.children[0]
          const arrow = new THREE.Vector3(0, 0, -1).transformDirection(pad.matrixWorld)
          const projection = nearestTrackPoint(hazard, track)
          expect(arrow.dot(new THREE.Vector3(projection.tangentX, 0, projection.tangentZ))).toBeGreaterThan(0.99)
        }
      } finally { visual.dispose() }
    })

    it(`${track.name} loads scenery, synchronizes pickups, and animates starting lights`, () => {
      const visual = createTrackMesh(track, models)
      try {
        const scenery = visual.group.getObjectByName('blender-scenery')!
        expect(scenery).toBeDefined()
        const instanced = scenery.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh)
        expect(instanced.length).toBeGreaterThan(0)
        expect(instanced.every(mesh => mesh.boundingSphere !== null && mesh.boundingSphere.radius < 200)).toBe(true)
        const vegetation = instanced.filter(mesh => /^(grass_clump|bush_low|fern_cluster|wildflowers)/.test(mesh.name))
        expect(vegetation.length > 0).toBe(!track.theme || track.theme === 'forest')
        if (!track.theme || track.theme === 'forest') {
          const distantTrees = new Set<string>()
          for (const mesh of instanced.filter(mesh => mesh.name.startsWith('tree_'))) {
            for (let i = 0; i < mesh.count; i++) {
              const matrix = new THREE.Matrix4()
              mesh.getMatrixAt(i, matrix)
              const position = new THREE.Vector3().setFromMatrixPosition(matrix)
              if (nearestTrackPoint(position, track).distance > 100) {
                distantTrees.add(`${position.x}:${position.z}`)
              }
            }
          }
          expect(distantTrees.size).toBeGreaterThan(100)
        }
        for (const mesh of vegetation) {
          mesh.geometry.computeBoundingBox()
          for (let i = 0; i < mesh.count; i++) {
            const matrix = new THREE.Matrix4()
            mesh.getMatrixAt(i, matrix)
            const box = mesh.geometry.boundingBox!.clone().applyMatrix4(matrix)
            const center = box.getCenter(new THREE.Vector3())
            const radius = Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z) / 2
            expect(nearestTrackPoint(center, track).distance - radius).toBeGreaterThan(TRACK_WIDTH / 2)
            expect(box.min.y).toBeGreaterThanOrEqual(-0.05)
          }
        }
        const item = visual.group.getObjectByName('item-box-0')!
        visual.update(1, 1000, [], [], [])
        expect(item.visible).toBe(false)
        visual.update(2, 2000, [{ id: 0, x: track.itemBoxes[0].x, z: track.itemBoxes[0].z, availableAt: 0 }], [], [])
        expect(item.visible).toBe(true)
        const lamps: THREE.MeshStandardMaterial[] = []
        scenery.traverse(node => {
          if (node instanceof THREE.Mesh && node.material instanceof THREE.MeshStandardMaterial && node.material.name === 'signal_red') lamps.push(node.material)
        })
        expect(lamps).toHaveLength(5)
        visual.updateLights?.('lobby', null, 1000)
        expect(lamps.every(material => material.emissiveIntensity === 0)).toBe(true)
        visual.updateLights?.('countdown', 4000, 3990)
        expect(lamps.every(material => material.emissiveIntensity > 0 && material.color.getHex() === 0xff2525)).toBe(true)
        visual.updateLights?.('racing', null, 4100)
        expect(lamps.every(material => material.color.getHex() === 0x39ed83)).toBe(true)
      } finally {
        visual.dispose()
      }
    })
  }
})
