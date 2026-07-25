import * as THREE from 'three'
import { CHECKPOINTS, nearestTrackPoint, TRACK_POINTS } from '../shared/track.js'
import { TRACK_WIDTH } from '../shared/constants.js'

export interface TrackVisual {
  group: THREE.Group
  dispose: () => void
}

function createStripGeometry(leftOffset: number, rightOffset: number, y: number, alternatingGroups = false): THREE.BufferGeometry {
  const positions: number[] = []
  const indices: number[] = []
  for (let index = 0; index < TRACK_POINTS.length; index += 1) {
    const previous = TRACK_POINTS[(index - 1 + TRACK_POINTS.length) % TRACK_POINTS.length]
    const point = TRACK_POINTS[index]
    const next = TRACK_POINTS[(index + 1) % TRACK_POINTS.length]
    const tangentX = next.x - previous.x
    const tangentZ = next.z - previous.z
    const tangentLength = Math.max(0.0001, Math.hypot(tangentX, tangentZ))
    const sideX = tangentZ / tangentLength
    const sideZ = -tangentX / tangentLength
    positions.push(point.x + sideX * leftOffset, y, point.z + sideZ * leftOffset)
    positions.push(point.x + sideX * rightOffset, y, point.z + sideZ * rightOffset)
  }
  for (let index = 0; index < TRACK_POINTS.length; index += 1) {
    const next = (index + 1) % TRACK_POINTS.length
    const left = index * 2
    const right = left + 1
    const nextLeft = next * 2
    const nextRight = nextLeft + 1
    indices.push(left, right, nextLeft, right, nextRight, nextLeft)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  if (alternatingGroups) {
    for (let index = 0; index < TRACK_POINTS.length; index += 1) {
      geometry.addGroup(index * 6, 6, index % 2)
    }
  }
  return geometry
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
}

export function createTrackMesh(): TrackVisual {
  const group = new THREE.Group()
  const roadGeometry = createStripGeometry(TRACK_WIDTH / 2, -TRACK_WIDTH / 2, 0.03)
  const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x343547, roughness: 0.92 })
  const curbWidth = 0.65
  const leftCurbGeometry = createStripGeometry(TRACK_WIDTH / 2 + curbWidth, TRACK_WIDTH / 2, 0.12, true)
  const rightCurbGeometry = createStripGeometry(-TRACK_WIDTH / 2, -TRACK_WIDTH / 2 - curbWidth, 0.12, true)
  const edgeMaterials = [
    new THREE.MeshStandardMaterial({ color: 0xf7efe4, roughness: 0.7 }),
    new THREE.MeshStandardMaterial({ color: 0xff4f70, roughness: 0.7 }),
  ]
  const road = new THREE.Mesh(roadGeometry, roadMaterial)
  road.receiveShadow = true
  const leftCurb = new THREE.Mesh(leftCurbGeometry, edgeMaterials)
  const rightCurb = new THREE.Mesh(rightCurbGeometry, edgeMaterials)
  leftCurb.receiveShadow = true
  rightCurb.receiveShadow = true
  group.add(road, leftCurb, rightCurb)

  const markerGeometry = new THREE.BoxGeometry(TRACK_WIDTH - 0.8, 0.03, 0.55)
  const checkpointMaterial = new THREE.MeshStandardMaterial({ color: 0x62e6ff, emissive: 0x1b6c7b, emissiveIntensity: 0.5 })
  const startMaterial = new THREE.MeshStandardMaterial({ color: 0xf6f1df })
  CHECKPOINTS.forEach((checkpoint, index) => {
    const marker = new THREE.Mesh(markerGeometry, index === 0 ? startMaterial : checkpointMaterial)
    marker.position.set(checkpoint.x, 0.15, checkpoint.z)
    marker.rotation.y = Math.atan2(checkpoint.normalX, checkpoint.normalZ)
    group.add(marker)
  })

  const trunkGeometry = new THREE.CylinderGeometry(0.28, 0.38, 2.2, 6)
  const crownGeometry = new THREE.ConeGeometry(1.35, 3.4, 7)
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x6e4939, roughness: 1 })
  const crownMaterial = new THREE.MeshStandardMaterial({ color: 0x2ca66f, roughness: 0.95 })
  const treeCount = 70
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, treeCount)
  const crowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, treeCount)
  const matrix = new THREE.Matrix4()
  const random = seededRandom(0x4e454f4e)
  let placedTrees = 0
  let attempts = 0
  while (placedTrees < treeCount && attempts < 5_000) {
    attempts += 1
    const x = -118 + random() * 230
    const z = -88 + random() * 178
    if (nearestTrackPoint({ x, z }).distance < TRACK_WIDTH / 2 + 5) continue
    if (Math.abs(x - 8) < 14 && Math.abs(z + 88) < 9) continue
    matrix.makeTranslation(x, 1.1, z)
    trunks.setMatrixAt(placedTrees, matrix)
    matrix.makeTranslation(x, 3.4, z)
    crowns.setMatrixAt(placedTrees, matrix)
    placedTrees += 1
  }
  trunks.count = placedTrees
  crowns.count = placedTrees
  trunks.castShadow = true
  crowns.castShadow = true
  group.add(trunks, crowns)

  const standMaterial = new THREE.MeshStandardMaterial({ color: 0x6d6ae8, roughness: 0.75 })
  const standGeometry = new THREE.BoxGeometry(17, 4, 6)
  const stand = new THREE.Mesh(standGeometry, standMaterial)
  stand.position.set(8, 2, -88)
  stand.castShadow = true
  group.add(stand)

  return {
    group,
    dispose: () => {
      roadGeometry.dispose()
      roadMaterial.dispose()
      leftCurbGeometry.dispose()
      rightCurbGeometry.dispose()
      edgeMaterials.forEach((material) => material.dispose())
      markerGeometry.dispose()
      checkpointMaterial.dispose()
      startMaterial.dispose()
      trunkGeometry.dispose()
      crownGeometry.dispose()
      trunkMaterial.dispose()
      crownMaterial.dispose()
      standMaterial.dispose()
      standGeometry.dispose()
    },
  }
}
