import * as THREE from 'three'
import type { TrackDefinition } from '../shared/track.js'
import type { ModelLibrary } from './models.js'

/** A decorative railway beyond an oriented bounding box of the entire circuit. */
export function createSceneryTrain(track: TrackDefinition, models: ModelLibrary, reducedMotion: boolean) {
  const group = new THREE.Group()
  group.name = 'scenery-railway'
  const start = track.checkpoints[0]
  const heading = Math.atan2(start.normalX, start.normalZ)
  const forward = new THREE.Vector2(Math.sin(heading), Math.cos(heading))
  const right = new THREE.Vector2(Math.cos(heading), -Math.sin(heading))
  const along = track.points.map(p => p.x * forward.x + p.z * forward.y)
  const across = track.points.map(p => p.x * right.x + p.z * right.y)
  const startAcross = start.x * right.x + start.z * right.y
  const low = Math.min(...across)
  const high = Math.max(...across)
  const side = startAcross - low < high - startAcross ? low - 45 : high + 45
  // Wrap outside the visible range, even with four wagons trailing the locomotive.
  const from = Math.min(...along) - 400
  const to = Math.max(...along) + 400
  const length = to - from
  const center = (from + to) / 2
  group.position.set(right.x * side + forward.x * center, 0, right.y * side + forward.y * center)
  group.rotation.y = heading
  const scale = 1.5
  const railBox = new THREE.Box3().setFromObject(models.get('rail_straight'))
  const railLength = (railBox.max.z - railBox.min.z) * scale
  const count = Math.ceil(length / railLength)
  const trackLength = count * railLength
  const matrix = new THREE.Matrix4()
  const transform = new THREE.Object3D()
  const rails: THREE.InstancedMesh[] = []
  for (const child of models.get('rail_straight').children) {
    if (!(child instanceof THREE.Mesh)) continue
    const mesh = new THREE.InstancedMesh(child.geometry, child.material, count)
    mesh.name = 'railway-rails'
    for (let i = 0; i < count; i++) {
      transform.position.set(0, 0.05, -trackLength / 2 + (i + 0.5) * railLength)
      transform.scale.setScalar(scale)
      transform.updateMatrix()
      matrix.copy(transform.matrix)
      mesh.setMatrixAt(i, matrix)
    }
    mesh.computeBoundingSphere()
    group.add(mesh)
    rails.push(mesh)
  }
  const bedGeometry = new THREE.BoxGeometry(4.5, 0.12, trackLength)
  const bedMaterial = new THREE.MeshStandardMaterial({ color: 0x666052, roughness: 1 })
  const bed = new THREE.Mesh(bedGeometry, bedMaterial)
  bed.name = 'railway-ballast'
  group.add(bed)
  const train = new THREE.Group()
  train.name = 'freight-train'
  group.add(train)
  for (let i = 0; i < 5; i++) {
    const car = models.clone(i === 0 ? 'train_engine' : 'train_wagon')
    car.scale.setScalar(scale)
    car.position.set(0, railBox.max.y * scale + 0.05, -i * 16.5)
    train.add(car)
  }
  const startAlong = start.x * forward.x + start.z * forward.y - center
  const initial = startAlong + 35
  function update(time: number) {
    train.position.z = reducedMotion ? initial : ((initial + length / 2 + time * 14) % length) - length / 2
  }
  update(0)
  return {
    group, update,
    dispose: () => {
      rails.forEach(mesh => mesh.dispose())
      bedGeometry.dispose()
      bedMaterial.dispose()
    },
  }
}
