import * as THREE from 'three'
import { TRACK_WIDTH } from '../shared/constants.js'
import { getTrackLength, nearestTrackPoint, type TrackDefinition } from '../shared/track.js'
import { type ModelLibrary, type RacingModel } from './models.js'
import type { RacePhase } from '../shared/protocol.js'

export function createModelScenery(track: TrackDefinition, models: ModelLibrary) {
  const group = new THREE.Group()
  group.name = 'blender-scenery'
  const batches = new Map<string, { id: RacingModel; matrices: THREE.Matrix4[] }>()
  const bounds = new Map<RacingModel, THREE.Box3>()
  const transform = new THREE.Object3D()
  const point = new THREE.Vector3()

  function place(id: RacingModel, x: number, z: number, heading = 0, scale = 1, onRoad = false) {
    let box = bounds.get(id)
    if (!box) {
      box = new THREE.Box3().setFromObject(models.get(id))
      bounds.set(id, box)
    }
    transform.position.set(x, 0, z)
    transform.rotation.set(0, heading, 0)
    transform.scale.setScalar(scale)
    transform.updateMatrix()
    if (!onRoad) {
      // Check the full footprint, including offset-origin modular pieces.
      const radius = Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z) * scale / 2
      box.getCenter(point).applyMatrix4(transform.matrix)
      if (nearestTrackPoint(point, track).distance < TRACK_WIDTH / 2 + radius + 2) return
    }
    const key = `${id}:${Math.floor(x / 100)}:${Math.floor(z / 100)}`
    const batch = batches.get(key) ?? { id, matrices: [] }
    batch.matrices.push(transform.matrix.clone())
    batches.set(key, batch)
  }

  const forest = !track.theme || track.theme === 'forest'
  const desert = track.theme === 'desert'
  const small: RacingModel[] = forest
    ? ['tree_pine', 'tree_birch', 'tree_broadleaf', 'boulder_01', 'boulder_02', 'boulder_03', 'stacked_logs']
    : desert ? ['cactus_saguaro', 'cactus_cluster', 'sandstone_spire', 'utility_pole']
      : ['shipping_container_blue', 'shipping_container_red', 'shipping_container_papaya', 'oil_barrel_blue', 'oil_barrel_rust']
  const landmarks: RacingModel[] = forest ? ['ranger_cabin', 'tree_pine', 'boulder_03']
    : desert ? ['sandstone_arch', 'sandstone_mesa', 'abandoned_gas_station']
      : ['warehouse', 'dock_crane', 'cargo_ship']
  const count = Math.ceil(getTrackLength(track) / 22)
  let vegetationSeed = 1847
  const vegetationRandom = () => {
    vegetationSeed = (Math.imul(vegetationSeed, 1664525) + 1013904223) >>> 0
    return vegetationSeed / 0x100000000
  }
  function plantCluster(x: number, z: number, sample: number, underTree = false) {
    const species: RacingModel[] = underTree
      ? ['fern_cluster', 'grass_clump_low', 'bush_low', 'grass_clump_low']
      : ['grass_clump_low', 'grass_clump_tall', 'bush_low',
        sample % 2 ? 'wildflowers_cream' : 'wildflowers_lavender', 'grass_clump_low']
    for (let plant = 0; plant < 7; plant++) {
      const angle = vegetationRandom() * Math.PI * 2
      const radius = 0.8 + Math.sqrt(vegetationRandom()) * 3.2
      place(species[plant % species.length], x + Math.cos(angle) * radius,
        z + Math.sin(angle) * radius, vegetationRandom() * Math.PI * 2,
        0.8 + vegetationRandom() * 0.65)
    }
  }
  for (let sample = 0; sample < count; sample++) {
    const index = Math.floor(sample / count * track.points.length)
    const p = track.points[index]
    const next = track.points[(index + 1) % track.points.length]
    const heading = Math.atan2(next.x - p.x, next.z - p.z)
    const sideX = Math.cos(heading)
    const sideZ = -Math.sin(heading)
    for (const side of [-1, 1]) {
      const offset = side * (18 + (sample * 17 % 29))
      place(small[(sample + (side === 1 ? 2 : 0)) % small.length], p.x + sideX * offset, p.z + sideZ * offset, heading + sample * 0.7)
      if (forest) {
        // Understory connects the existing trees and rocks to the ground.
        plantCluster(p.x + sideX * offset, p.z + sideZ * offset, sample, true)
        // Uneven pockets leave open grass between patches and keep sightlines clear.
        if (sample % 5 !== 0) {
          const verge = side * (15 + vegetationRandom() * 5)
          plantCluster(p.x + sideX * verge, p.z + sideZ * verge, sample)
        }
      }
    }
    if (sample % 3 === 0) {
      const side = sample % 2 ? -1 : 1
      const props: RacingModel[] = ['tire_stack_red_white', 'traffic_cone_papaya', 'tire_stack_black', 'traffic_cone_yellow', 'tire_wall', 'concrete_barrier_papaya', 'guardrail_straight_4m']
      place(props[Math.floor(sample / 3) % props.length], p.x + sideX * side * 13, p.z + sideZ * side * 13, heading)
    }
    const ahead = track.points[(index + 8) % track.points.length]
    const turn = Math.sin(Math.atan2(ahead.x - next.x, ahead.z - next.z) - heading)
    if (Math.abs(turn) > 0.08 && sample % 2 === 0) {
      const outside = turn > 0 ? -1 : 1
      // Signs face approaching cars, so their local X axis opposes the road's side axis.
      place(turn > 0 ? 'chevron_board_left' : 'chevron_board_right', p.x + sideX * outside * 13, p.z + sideZ * outside * 13, heading + Math.PI)
    }
    if (sample % 12 === 0) {
      place(landmarks[Math.floor(sample / 12) % landmarks.length], p.x + sideX * 65, p.z + sideZ * 65, heading - Math.PI / 2)
      if (forest) {
        const x = p.x - sideX * 55
        const z = p.z - sideZ * 55
        const local = (across: number, along: number) => ({
          x: x + sideX * across + Math.sin(heading) * along,
          z: z + sideZ * across + Math.cos(heading) * along,
        })
        place('ruin_arch', x, z, heading, 3)
        for (const side of [-1, 1]) {
          const wall = local(side * 10, 6)
          place('ruin_wall', wall.x, wall.z, heading + (side === 1 ? Math.PI / 2 : 0), 3)
          const column = local(side * 7, -5)
          place('ruin_column', column.x, column.z, heading, 3)
          plantCluster(wall.x, wall.z, sample, true)
        }
      }
    }
  }

  if (forest) {
    // Fill the landscape in world-space cells so nearby bends share one forest,
    // rather than adding overlapping rows of scenery for each road segment.
    const plantedCells = new Set<string>()
    const trees: RacingModel[] = ['tree_pine', 'tree_broadleaf', 'tree_pine', 'tree_birch']
    for (let sample = 0; sample < count; sample++) {
      const index = Math.floor(sample / count * track.points.length)
      const p = track.points[index]
      const next = track.points[(index + 1) % track.points.length]
      const heading = Math.atan2(next.x - p.x, next.z - p.z)
      for (const side of [-1, 1]) {
        for (const depth of [55, 80, 110, 145, 185, 220]) {
          const cellX = Math.floor((p.x + Math.cos(heading) * side * depth) / 24)
          const cellZ = Math.floor((p.z - Math.sin(heading) * side * depth) / 24)
          const key = `${cellX}:${cellZ}`
          if (plantedCells.has(key)) continue
          plantedCells.add(key)
          const x = (cellX + 0.5) * 24
          const z = (cellZ + 0.5) * 24
          const distance = nearestTrackPoint({ x, z }, track).distance
          // Preserve the existing verge and paddock; distant groves have gaps.
          if (distance < 42 || vegetationRandom() < 0.12) continue
          for (let tree = 0; tree < 5; tree++) {
            const tx = x + (vegetationRandom() - 0.5) * 22
            const tz = z + (vegetationRandom() - 0.5) * 22
            place(trees[Math.floor(vegetationRandom() * trees.length)], tx, tz,
              vegetationRandom() * Math.PI * 2, 1.1 + vegetationRandom() * 1.4)
          }
          if (vegetationRandom() < 0.35) {
            place('boulder_03', x + 5, z - 3, vegetationRandom() * Math.PI * 2,
              1.6 + vegetationRandom() * 1.8)
          }
          // Tiny leaves don't contribute to the silhouette beyond the middle distance.
          if (distance < 110) plantCluster(x, z, sample, true)
        }
      }
    }
  }

  const start = track.checkpoints[0]
  const heading = Math.atan2(start.normalX, start.normalZ)
  // The source has a 12 m opening; scale its opening beyond the 17 m road.
  const gantry = models.clone('start_finish_gantry')
  gantry.name = 'start-finish-gantry'
  gantry.position.set(start.x, 0, start.z)
  gantry.rotation.y = heading
  gantry.scale.setScalar(1.65)
  group.add(gantry)
  const lights: { index: number; material: THREE.MeshStandardMaterial }[] = []
  gantry.traverse(node => {
    const match = /__start_light_(\d+)/.exec(node.name)
    if (!match) return
    node.traverse(part => {
      if (!(part instanceof THREE.Mesh) || !(part.material instanceof THREE.MeshStandardMaterial)) return
      part.material = part.material.clone()
      lights.push({ index: Number(match[1]) - 1, material: part.material })
    })
  })
  const paddock: RacingModel[] = ['grandstand_covered', 'pit_garage', 'marshal_post', 'grandstand_small', 'winners_podium', 'flag_checkered', 'flag_blue', 'flag_papaya', 'guardrail_corner_90', 'guardrail_end']
  paddock.forEach((id, index) => {
    const along = (Math.floor(index / 2) - 2) * 20
    const side = index % 2 ? -1 : 1
    place(id, start.x + start.normalZ * side * 27 + start.normalX * along,
      start.z - start.normalX * side * 27 + start.normalZ * along,
      heading - side * Math.PI / 2)
  })

  const meshes: THREE.InstancedMesh[] = []
  for (const batch of batches.values()) {
    for (const child of models.get(batch.id).children) {
      if (!(child instanceof THREE.Mesh)) continue
      const mesh = new THREE.InstancedMesh(child.geometry, child.material, batch.matrices.length)
      mesh.name = batch.id
      batch.matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix))
      mesh.castShadow = mesh.receiveShadow = true
      mesh.computeBoundingSphere()
      group.add(mesh)
      meshes.push(mesh)
    }
  }
  return {
    group,
    updateLights: (phase?: RacePhase, countdownEndsAt?: number | null, serverTime = 0) => {
      const lit = phase === 'countdown' && countdownEndsAt != null
        ? Math.max(1, Math.min(5, Math.ceil((3000 - (countdownEndsAt - serverTime)) / 600))) : 0
      for (const { index, material } of lights) {
        const active = phase === 'racing' || index < lit
        const color = phase === 'racing' ? 0x39ed83 : active ? 0xff2525 : 0x220606
        material.color.setHex(color)
        material.emissive.setHex(color)
        material.emissiveIntensity = active ? 1.5 : 0
      }
    },
    dispose: () => {
      meshes.forEach(mesh => mesh.dispose())
      lights.forEach(light => light.material.dispose())
    },
  }
}
