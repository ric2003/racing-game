import * as THREE from 'three'
import { DEFAULT_TRACK, nearestTrackPoint, type TrackDefinition } from '../shared/track.js'
import { TRACK_WIDTH } from '../shared/constants.js'

export interface TrackVisual {
  group: THREE.Group
  dispose: () => void
}

type Position3 = [number, number, number]

function appendTriangle(positions: number[], first: Position3, second: Position3, third: Position3): void {
  const firstX = second[0] - first[0]
  const firstZ = second[2] - first[2]
  const secondX = third[0] - first[0]
  const secondZ = third[2] - first[2]
  const normalY = firstZ * secondX - firstX * secondZ
  const ordered = normalY >= 0 ? [first, second, third] : [first, third, second]
  for (const point of ordered) positions.push(...point)
}

function offsetPoint(point: { x: number; z: number }, sideX: number, sideZ: number, offset: number, y: number): Position3 {
  return [point.x + sideX * offset, y, point.z + sideZ * offset]
}

function segmentSide(track: TrackDefinition, index: number): { x: number; z: number } {
  const start = track.points[index]
  const end = track.points[(index + 1) % track.points.length]
  const dx = end.x - start.x
  const dz = end.z - start.z
  const length = Math.max(0.0001, Math.hypot(dx, dz))
  return { x: dz / length, z: -dx / length }
}

function createStripGeometry(track: TrackDefinition, leftOffset: number, rightOffset: number, y: number, alternatingGroups = false): THREE.BufferGeometry {
  const positions: number[] = []
  for (let index = 0; index < track.points.length; index += 1) {
    const point = track.points[index]
    const next = track.points[(index + 1) % track.points.length]
    const side = segmentSide(track, index)
    const nextSide = segmentSide(track, (index + 1) % track.points.length)
    const startLeft = offsetPoint(point, side.x, side.z, leftOffset, y)
    const startRight = offsetPoint(point, side.x, side.z, rightOffset, y)
    const endLeft = offsetPoint(next, side.x, side.z, leftOffset, y)
    const endRight = offsetPoint(next, side.x, side.z, rightOffset, y)
    const joinLeft = offsetPoint(next, nextSide.x, nextSide.z, leftOffset, y)
    const joinRight = offsetPoint(next, nextSide.x, nextSide.z, rightOffset, y)

    appendTriangle(positions, startLeft, startRight, endLeft)
    appendTriangle(positions, startRight, endRight, endLeft)
    if (leftOffset * rightOffset < 0) {
      const center: Position3 = [next.x, y, next.z]
      appendTriangle(positions, endLeft, center, joinLeft)
      appendTriangle(positions, endRight, joinRight, center)
    } else {
      appendTriangle(positions, endLeft, endRight, joinLeft)
      appendTriangle(positions, endRight, joinRight, joinLeft)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  if (alternatingGroups) {
    for (let index = 0; index < track.points.length; index += 1) {
      // Keep each segment and its corner join in the same curb color.
      // Vertices are local because a naive shared offset polyline can fold
      // across the road at the two tight hairpins.
      geometry.addGroup(index * 12, 12, index % 2)
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

export function createTrackMesh(track: TrackDefinition = DEFAULT_TRACK): TrackVisual {
  const group = new THREE.Group()
  const roadGeometry = createStripGeometry(track, TRACK_WIDTH / 2, -TRACK_WIDTH / 2, 0.03)
  const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x343547, roughness: 0.92 })
  const curbWidth = 0.65
  const leftCurbGeometry = createStripGeometry(track, TRACK_WIDTH / 2 + curbWidth, TRACK_WIDTH / 2, 0.12, true)
  const rightCurbGeometry = createStripGeometry(track, -TRACK_WIDTH / 2, -TRACK_WIDTH / 2 - curbWidth, 0.12, true)
  const edgeMaterials = [
    new THREE.MeshStandardMaterial({ color: 0xf7efe4, roughness: 0.7, depthWrite: false }),
    new THREE.MeshStandardMaterial({ color: 0xff4f70, roughness: 0.7, depthWrite: false }),
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
  track.checkpoints.forEach((checkpoint, index) => {
    const marker = new THREE.Mesh(markerGeometry, index === 0 ? startMaterial : checkpointMaterial)
    marker.position.set(checkpoint.x, 0.15, checkpoint.z)
    marker.rotation.y = Math.atan2(checkpoint.normalX, checkpoint.normalZ)
    group.add(marker)
  })

  const itemGeometry = new THREE.OctahedronGeometry(0.7, 1)
  const itemMaterial = new THREE.MeshStandardMaterial({ color: 0x56d9f3, emissive: 0x1b6c7b, emissiveIntensity: 1.2, roughness: 0.35, metalness: 0.2 })
  for (const point of track.itemBoxes) {
    const item = new THREE.Mesh(itemGeometry, itemMaterial)
    item.position.set(point.x, 0.85, point.z)
    item.castShadow = true
    group.add(item)
  }
  const padGeometry = new THREE.BoxGeometry(5.2, 0.08, 2.2)
  const padMaterial = new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0x8b5d09, emissiveIntensity: 0.8 })
  const barrierGeometry = new THREE.BoxGeometry(4.5, 1.4, 0.55)
  const barrierMaterial = new THREE.MeshStandardMaterial({ color: 0xff4f70, emissive: 0x7b142b, emissiveIntensity: 0.6 })
  for (const hazard of track.hazards) {
    const visual = new THREE.Mesh(hazard.type === 'boost-pad' ? padGeometry : barrierGeometry, hazard.type === 'boost-pad' ? padMaterial : barrierMaterial)
    visual.position.set(hazard.x, hazard.type === 'boost-pad' ? 0.12 : 0.8, hazard.z)
    visual.rotation.y = hazard.phase ? hazard.phase * Math.PI * 2 : 0
    visual.castShadow = true
    group.add(visual)
  }

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
    if (nearestTrackPoint({ x, z }, track).distance < TRACK_WIDTH / 2 + 4) continue
    if (Math.abs(x - 8) < 14 && Math.abs(z + 64) < 9) continue
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
  stand.position.set(8, 2, -64)
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
      itemGeometry.dispose()
      itemMaterial.dispose()
      padGeometry.dispose()
      padMaterial.dispose()
      barrierGeometry.dispose()
      barrierMaterial.dispose()
    },
  }
}
