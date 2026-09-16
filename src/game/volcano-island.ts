import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

/** This textured landmark bypasses the solid-color instancing library. */
export async function loadVolcanoIsland(reducedMotion: boolean) {
  const { scene: group } = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}assets/landmarks/volcano-island.glb`)
  group.name = 'volcano-island'
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  const lava = new Set<THREE.MeshStandardMaterial>()
  const clouds: { node: THREE.Object3D; origin: THREE.Vector3; drift: THREE.Vector3 }[] = []
  group.updateMatrixWorld(true)
  const sourceHeight = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3()).y
  group.traverse(node => {
    if (node.name === 'Clouds' && node.parent) {
      const inverse = node.parent.matrixWorld.clone().invert()
      const drift = new THREE.Vector3(0, sourceHeight * 0.01, 0).applyMatrix4(inverse)
        .sub(new THREE.Vector3().applyMatrix4(inverse))
      clouds.push({ node, origin: node.position.clone(), drift })
    }
    if (!(node instanceof THREE.Mesh)) return
    geometries.add(node.geometry)
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material)
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value)
      }
      // Keep the landmark visible beyond the nearby forest fog.
      material.fog = false
      if (material instanceof THREE.MeshStandardMaterial) {
        material.roughness = 1
        material.metalness = 0
        if (material.name === 'Volcanic_lava') lava.add(material)
      }
    }
  })
  const remove: THREE.Object3D[] = []
  group.traverse(node => {
    if (node.name === 'Ocean' || node instanceof THREE.Light || node instanceof THREE.Camera) remove.push(node)
  })
  remove.forEach(node => node.removeFromParent())
  return {
    group,
    update: (time: number) => {
      const t = reducedMotion ? 0 : time
      clouds.forEach(({ node, origin, drift }) => { node.position.copy(origin).addScaledVector(drift, Math.sin(t * 0.45)) })
      lava.forEach(material => { material.emissiveIntensity = 0.85 + Math.sin(t * 1.2) * 0.15 })
    },
    dispose: () => {
      geometries.forEach(geometry => geometry.dispose())
      materials.forEach(material => material.dispose())
      textures.forEach(texture => {
        if (typeof ImageBitmap !== 'undefined' && texture.source.data instanceof ImageBitmap) texture.source.data.close()
        texture.dispose()
      })
    },
  }
}
