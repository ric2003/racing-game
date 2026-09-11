import * as THREE from 'three'
import { nearestTrackPoint, type TrackDefinition } from '../shared/track.js'
import { TRACK_WIDTH } from '../shared/constants.js'

// Scenery is visual only. Keep its footprint outside every section of the road.
export function createLongTrackScenery(track: TrackDefinition) {
  const group = new THREE.Group()
  group.name = 'long-track-scenery'
  const geometries = {
    box: new THREE.BoxGeometry(1, 1, 1),
    rock: new THREE.DodecahedronGeometry(1, 0),
    cone: new THREE.ConeGeometry(1, 1, 7),
    cylinder: new THREE.CylinderGeometry(1, 1, 1, 7),
  }
  type Shape = keyof typeof geometries
  const forest = track.theme === 'forest'
  const harbor = track.theme === 'harbor'
  const palette = forest
    ? [0x264c3c, 0x39724c, 0x6e8760, 0x69777a, 0x745a42, 0xe2d9ba]
    : harbor ? [0x286879, 0xb85d42, 0xd2a54d, 0x465c69, 0x284a5b, 0xe4d9b8]
      : [0xa65d3f, 0xca8251, 0xe2ac70, 0x637b49, 0x754834, 0xf1d8a7]
  const materials = palette.map(color => new THREE.MeshStandardMaterial({ color, roughness: 0.94 }))
  const batches = new Map<string, { shape: Shape; color: number; transforms: THREE.Matrix4[] }>()
  const transform = new THREE.Object3D()
  let seed = 0x41504558
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }
  function add(shape: Shape, color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, rotation = 0) {
    // Spatial batches keep far-away scenery out of the render work.
    const key = `${shape}:${color}:${Math.floor(x / 160)}:${Math.floor(z / 160)}`
    let batch = batches.get(key)
    if (!batch) {
      batch = { shape, color, transforms: [] }
      batches.set(key, batch)
    }
    transform.position.set(x, y, z)
    transform.rotation.set(0, rotation, 0)
    transform.scale.set(sx, sy, sz)
    transform.updateMatrix()
    batch.transforms.push(transform.matrix.clone())
  }
  const clear = (x: number, z: number, radius: number) => nearestTrackPoint({ x, z }, track).distance > TRACK_WIDTH / 2 + radius + 3

  // Several layers: low roadside detail, mid-distance clusters, distant silhouettes.
  for (let i = 0; i < track.points.length; i += 6) {
    const point = track.points[i]
    const next = track.points[(i + 1) % track.points.length]
    const angle = Math.atan2(next.x - point.x, next.z - point.z)
    const sideX = Math.cos(angle)
    const sideZ = -Math.sin(angle)
    const district = Math.floor(i / track.points.length * 8)
    if (i % 12 === 0) {
      for (const side of [-1, 1]) {
        const x = point.x + sideX * side * (12 + random() * 5)
        const z = point.z + sideZ * side * (12 + random() * 5)
        if (clear(x, z, 2.5)) {
          if (forest) add('rock', 1, x, 0.5, z, 2.5, 1.2, 2)
          else if (!harbor) add('rock', 2, x, 0.4, z, 1.4, 0.8, 1.1)
        }
      }
    }

    for (const side of [-1, 1]) {
      const offset = side * (18 + random() * 46)
      const x = point.x + sideX * offset
      const z = point.z + sideZ * offset
      if (!clear(x, z, 9)) continue
      if (forest) {
        const height = 7 + random() * 9
        if (district % 3 === 1) {
          add('rock', 3, x, 2, z, 5, 4, 4, random() * Math.PI)
          add('rock', 2, x + 4, 1, z + 2, 3, 2, 3)
        } else {
          add('cylinder', 4, x, height * 0.3, z, 0.55, height * 0.6, 0.55)
          add('cone', district % 2, x, height * 0.65, z, 3.5, height * 0.8, 3.5)
          add('cone', 1, x, height * 0.85, z, 2.6, height * 0.55, 2.6)
        }
      } else if (harbor) {
        const stacks = 1 + Math.floor(random() * 3)
        for (let level = 0; level < stacks; level++) {
          add('box', (district + level) % 3, x, 1.6 + level * 3.2, z, 6, 3.1, 12, angle)
          // A light roof edge breaks up the silhouette of each container stack.
          add('box', 5, x, 3.17 + level * 3.2, z, 6.1, 0.08, 12.1, angle)
        }
      } else {
        if (district % 3 === 0) {
          add('cylinder', 3, x, 3.3, z, 0.65, 6.6, 0.65)
          add('box', 3, x + 1, 3, z, 2.2, 0.7, 0.7)
          add('cylinder', 3, x + 1.8, 3.8, z, 0.4, 2.3, 0.4)
        } else {
          add('rock', district % 2, x, 1.8, z, 4, 3.5, 3, random() * Math.PI)
        }
      }
    }

    if (i % 48 === 0) {
      for (const side of [-1, 1]) {
        const x = point.x + sideX * side * (TRACK_WIDTH / 2 + 2)
        const z = point.z + sideZ * side * (TRACK_WIDTH / 2 + 2)
        if (nearestTrackPoint({ x, z }, track).distance < TRACK_WIDTH / 2 + 1) continue
        add('box', 3, x, 0.7, z, 0.25, 1.4, 0.25, angle)
        add('box', 5, x, 1.2, z, 0.3, 0.24, 0.3, angle)
      }
    }
  }

  for (let sector = 0; sector < 24; sector++) {
    const index = Math.floor((sector + 0.4) / 24 * track.points.length)
    const point = track.points[index]
    const next = track.points[(index + 1) % track.points.length]
    const angle = Math.atan2(next.x - point.x, next.z - point.z)
    const side = sector % 2 ? 1 : -1
    const x = point.x + Math.cos(angle) * side * 95
    const z = point.z - Math.sin(angle) * side * 95
    if (!clear(x, z, 42)) continue
    if (harbor) {
      // Dock basin and a gantry crane, both clear of the drivable circuit.
      add('box', 4, x, -0.015, z, 64, 0.08, 48, angle)
      const local = (dx: number, dz: number) => ({ x: x + Math.cos(angle) * dx + Math.sin(angle) * dz, z: z - Math.sin(angle) * dx + Math.cos(angle) * dz })
      for (const dx of [-16, 16]) {
        const p = local(dx, 0)
        add('box', 2, p.x, 16, p.z, 1.8, 32, 2, angle)
      }
      add('box', 2, x, 32, z, 37, 2.5, 3, angle)
      add('box', 3, x, 29, z, 5, 4, 5, angle)
      add('box', 5, x, 20, z, 0.18, 16, 0.18)
    } else if (forest) {
      add('rock', 3, x, 10, z, 30, 23, 24, angle)
      add('rock', 2, x + 12, 5, z + 8, 20, 12, 18, angle)
      for (let tree = 0; tree < 6; tree++) {
        const tx = x - 20 + tree * 7
        add('cone', tree % 2, tx, 10, z - 16, 6, 20 + random() * 8, 6)
      }
    } else {
      add('cylinder', 0, x, 9, z, 29, 18, 24, angle)
      add('cylinder', 1, x, 21, z, 23, 8, 19, angle)
      add('cylinder', 2, x, 26, z, 19, 2, 16, angle)
    }
  }

  // A finish gantry makes the home straight recognizable from a distance.
  const start = track.checkpoints[0]
  const heading = Math.atan2(start.normalX, start.normalZ)
  for (const side of [-1, 1]) {
    add('box', 3, start.x + start.normalZ * side * 9, 4.5, start.z - start.normalX * side * 9, 0.8, 9, 0.8, heading)
  }
  add('box', 3, start.x, 8.8, start.z, 18.8, 1.3, 0.8, heading)
  for (let tile = 0; tile < 18; tile++) {
    for (let row = 0; row < 2; row++) {
      const offset = tile - 8.5
      add('box', (tile + row) % 2 ? 3 : 5, start.x + start.normalZ * offset, 8.5 + row * 0.6, start.z - start.normalX * offset, 0.95, 0.55, 0.86, heading)
    }
  }

  const meshes: THREE.InstancedMesh[] = []
  for (const batch of batches.values()) {
    const mesh = new THREE.InstancedMesh(geometries[batch.shape], materials[batch.color], batch.transforms.length)
    batch.transforms.forEach((matrix, index) => mesh.setMatrixAt(index, matrix))
    mesh.computeBoundingSphere()
    mesh.receiveShadow = true
    mesh.castShadow = batch.shape !== 'box' || batch.color !== 4
    group.add(mesh)
    meshes.push(mesh)
  }
  return {
    group,
    dispose: () => {
      meshes.forEach(mesh => mesh.dispose())
      Object.values(geometries).forEach(geometry => geometry.dispose())
      materials.forEach(material => material.dispose())
    },
  }
}
