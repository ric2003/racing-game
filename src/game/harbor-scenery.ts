import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { nearestTrackPoint, type TrackDefinition } from '../shared/track.js'
import { TRACK_WIDTH } from '../shared/constants.js'

export async function loadHarborScenery(track: TrackDefinition) {
  const group = new THREE.Group()
  group.name = 'harbor-landmarks'
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  const own = (object: THREE.Object3D) => object.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return
    geometries.add(node.geometry)
    node.castShadow = node.receiveShadow = true
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material)
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value)
    }
  })
  const dispose = () => {
    geometries.forEach(value => value.dispose())
    materials.forEach(value => value.dispose())
    const images = new Set<ImageBitmap>()
    textures.forEach(value => {
      if (typeof ImageBitmap !== 'undefined' && value.source.data instanceof ImageBitmap) images.add(value.source.data)
      value.dispose()
    })
    images.forEach(value => value.close())
  }
  if (track.theme !== 'harbor') return { group, dispose }
  const terminal = track.id === 'neon-harbor'
  const names = terminal ? ['cruise-liner'] : ['warehouse', 'factory', 'storage-tank']
  const loader = new GLTFLoader()
  const results = await Promise.allSettled(names.map(async name => {
    const { scene } = await loader.loadAsync(`${import.meta.env.BASE_URL}assets/harbor/${name}.glb`)
    own(scene)
    return scene
  }))
  const failure = results.find(result => result.status === 'rejected')
  if (failure?.status === 'rejected') { dispose(); throw failure.reason }
  const sources = results.map(result => (result as PromiseFulfilledResult<THREE.Group>).value)
  function model(index: number, length: number) {
    const object = sources[index].clone(true)
    const box = new THREE.Box3().setFromObject(object)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    object.position.sub(new THREE.Vector3(center.x, box.min.y, center.z))
    const wrapper = new THREE.Group()
    wrapper.add(object)
    wrapper.scale.setScalar(length / Math.max(size.x, size.z))
    return wrapper
  }
  function block(parent: THREE.Group, name: string, x: number, y: number, z: number,
    width: number, height: number, depth: number, color: number) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshStandardMaterial({ color, roughness: 0.85 }))
    mesh.name = name
    mesh.position.set(x, y, z)
    own(mesh)
    parent.add(mesh)
    return mesh
  }
  if (terminal) {
    const start = track.checkpoints[0]
    const heading = Math.atan2(start.normalX, start.normalZ)
    const right = new THREE.Vector2(Math.cos(heading), -Math.sin(heading))
    const forward = new THREE.Vector2(Math.sin(heading), Math.cos(heading))
    const across = track.points.map(p => p.x * right.x + p.z * right.y)
    const low = Math.min(...across), high = Math.max(...across)
    const startAcross = start.x * right.x + start.z * right.y
    const side = startAcross - low < high - startAcross ? -1 : 1
    const centerAcross = (side < 0 ? low : high) + side * 160
    const along = start.x * forward.x + start.z * forward.y + 45
    group.position.set(right.x * centerAcross + forward.x * along, 0, right.y * centerAcross + forward.y * along)
    group.rotation.y = heading
    block(group, 'terminal-water', 0, 0, 0, 100, 0.06, 200, 0x287b91)
    block(group, 'terminal-quay', -side * 59, 0.55, 0, 18, 1.2, 214, 0xadb1aa)
    for (const end of [-1, 1]) block(group, 'basin-breakwater', 0, 0.55, end * 104, 100, 1.2, 8, 0x8c9795)
    const ship = model(0, 100)
    ship.name = 'harbor-cruise-liner'
    ship.position.y = -3
    group.add(ship)
    for (let i = -4; i <= 4; i++) block(group, 'quay-bollard', -side * 52, 1.5, i * 21, 1.5, 1.8, 1.5, 0xe3b43a)
  } else {
    const spacing = Math.max(1, Math.floor(track.points.length / 24))
    for (let i = 0; i < track.points.length; i += spacing) {
      const p = track.points[i], next = track.points[(i + 1) % track.points.length]
      const heading = Math.atan2(next.x - p.x, next.z - p.z)
      for (const side of [-1, 1]) {
        const cluster = new THREE.Group()
        cluster.position.set(p.x + Math.cos(heading) * side * 85, 0, p.z - Math.sin(heading) * side * 85)
        cluster.rotation.y = heading
        const building = model(Math.floor(i / spacing) % 2, 32)
        cluster.add(building)
        for (const offset of [-11, 11]) {
          const tank = model(2, 12)
          tank.position.set(offset, 0, 30)
          cluster.add(tank)
        }
        const box = new THREE.Box3().setFromObject(cluster)
        const center = box.getCenter(new THREE.Vector3())
        const size = box.getSize(new THREE.Vector3())
        const radius = Math.hypot(size.x, size.z) / 2
        if (nearestTrackPoint(center, track).distance < TRACK_WIDTH / 2 + radius + 8) continue
        if (group.children.some(child => child.position.distanceTo(cluster.position) < 65)) continue
        cluster.name = 'industrial-yard'
        block(cluster, 'yard-concrete', 0, 0, 10, 48, 0.08, 60, 0x8b9697)
        group.add(cluster)
      }
    }
  }
  return { group, dispose }
}
