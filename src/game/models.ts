import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export const RACING_MODELS = [
  'start_finish_gantry', 'tire_stack_black', 'tire_stack_red_white', 'tire_wall',
  'concrete_barrier_concrete', 'concrete_barrier_papaya', 'guardrail_straight_4m',
  'guardrail_corner_90', 'guardrail_end', 'traffic_cone_yellow', 'traffic_cone_papaya',
  'chevron_board_left', 'chevron_board_right', 'tree_pine', 'tree_birch', 'tree_broadleaf',
  'boulder_01', 'boulder_02', 'boulder_03', 'stacked_logs', 'ranger_cabin',
  'sandstone_spire', 'sandstone_arch', 'sandstone_mesa', 'cactus_saguaro', 'cactus_cluster',
  'utility_pole', 'abandoned_gas_station', 'shipping_container_blue', 'shipping_container_red',
  'shipping_container_papaya', 'warehouse', 'dock_crane', 'cargo_ship',
  'item_pickup_crate', 'boost_pad', 'oil_barrel_blue', 'oil_barrel_rust',
  'grandstand_small', 'grandstand_covered', 'marshal_post', 'pit_garage',
  'flag_blue', 'flag_papaya', 'flag_checkered', 'winners_podium',
  'cannonball',
  'grass_clump_low', 'grass_clump_tall', 'bush_low', 'fern_cluster',
  'wildflowers_cream', 'wildflowers_lavender',
  'ruin_arch', 'ruin_column', 'ruin_wall', 'train_engine', 'train_wagon', 'rail_straight',
] as const

export type RacingModel = typeof RACING_MODELS[number]
export type ModelId = RacingModel | 'race-car'

/** One race scene owns these resources. Instances only borrow geometry/materials. */
export class ModelLibrary {
  private readonly models = new Map<ModelId, THREE.Group>()

  add(id: ModelId, source: THREE.Group) {
    source.updateMatrixWorld(true)
    if (id === 'race-car' || id === 'start_finish_gantry') {
      source.traverse(node => {
        if (node instanceof THREE.Mesh) node.castShadow = node.receiveShadow = true
      })
      this.models.set(id, source)
      return
    }
    // Bake static prop transforms and merge by material before instancing them.
    const parts = new Map<THREE.Material, THREE.BufferGeometry[]>()
    source.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return
      if (Array.isArray(node.material)) throw new Error(`Unexpected multi-material primitive: ${id}`)
      const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld)
      // This pack uses solid materials, so only positions and normals are needed.
      for (const attribute of Object.keys(geometry.attributes)) {
        if (attribute !== 'position' && attribute !== 'normal') geometry.deleteAttribute(attribute)
      }
      const list = parts.get(node.material) ?? []
      list.push(geometry.index ? geometry.toNonIndexed() : geometry)
      if (geometry.index) geometry.dispose()
      parts.set(node.material, list)
    })
    const model = new THREE.Group()
    for (const [material, geometries] of parts) {
      const merged = mergeGeometries(geometries)
      geometries.forEach(geometry => geometry.dispose())
      if (!merged) throw new Error(`Could not merge ${id}`)
      const mesh = new THREE.Mesh(merged, material)
      mesh.castShadow = mesh.receiveShadow = true
      model.add(mesh)
    }
    const originals = new Set<THREE.BufferGeometry>()
    source.traverse(node => { if (node instanceof THREE.Mesh) originals.add(node.geometry) })
    originals.forEach(geometry => geometry.dispose())
    this.models.set(id, model)
  }

  get(id: ModelId): THREE.Group {
    const model = this.models.get(id)
    if (!model) throw new Error(`Model not loaded: ${id}`)
    return model
  }

  clone(id: ModelId) { return this.get(id).clone(true) }

  dispose() {
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    this.models.forEach(model => model.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return
      geometries.add(node.geometry)
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material)
    }))
    geometries.forEach(geometry => geometry.dispose())
    materials.forEach(material => material.dispose())
    this.models.clear()
  }
}

export async function loadModels(): Promise<ModelLibrary> {
  const library = new ModelLibrary()
  const loader = new GLTFLoader()
  const ids: ModelId[] = ['race-car', ...RACING_MODELS]
  const results = await Promise.allSettled(ids.map(async id => {
    const folder = id === 'race-car' ? 'cars' : 'racing'
    const { scene } = await loader.loadAsync(`${import.meta.env.BASE_URL}assets/${folder}/${id}.glb`)
    library.add(id, scene)
  }))
  const failure = results.find(result => result.status === 'rejected')
  if (failure?.status === 'rejected') {
    library.dispose()
    throw failure.reason
  }
  return library
}
