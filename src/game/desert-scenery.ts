import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

/** Game-specific baked scene; source packs are kept outside the public assets. */
export async function loadDesertScenery() {
  const { scene: group } = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}assets/desert/desert-scenery.glb`)
  group.name = 'desert-landmarks'
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  group.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return
    node.castShadow = node.receiveShadow = true
    geometries.add(node.geometry)
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material)
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value)
    }
  })
  return { group, dispose: () => {
    geometries.forEach(value => value.dispose())
    materials.forEach(value => value.dispose())
    const images = new Set<ImageBitmap>()
    textures.forEach(value => {
      if (typeof ImageBitmap !== 'undefined' && value.source.data instanceof ImageBitmap) images.add(value.source.data)
      value.dispose()
    })
    images.forEach(value => value.close())
  } }
}
