import * as THREE from 'three'
import { CHECKPOINTS, TRACK_POINTS } from '../shared/track.js'
import { TRACK_WIDTH } from '../shared/constants.js'

export interface TrackVisual {
  group: THREE.Group
  dispose: () => void
}

export function createTrackMesh(): TrackVisual {
  const group = new THREE.Group()
  const roadGeometry = new THREE.BoxGeometry(1, 0.18, 1)
  const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x343547, roughness: 0.92 })
  const edgeGeometry = new THREE.BoxGeometry(1, 0.5, 0.34)
  const edgeMaterials = [
    new THREE.MeshStandardMaterial({ color: 0xf7efe4, roughness: 0.7 }),
    new THREE.MeshStandardMaterial({ color: 0xff4f70, roughness: 0.7 }),
  ]

  TRACK_POINTS.forEach((point, index) => {
    const next = TRACK_POINTS[(index + 1) % TRACK_POINTS.length]
    const dx = next.x - point.x
    const dz = next.z - point.z
    const length = Math.hypot(dx, dz) + 0.8
    const angle = Math.atan2(dx, dz)
    const road = new THREE.Mesh(roadGeometry, roadMaterial)
    road.position.set((point.x + next.x) / 2, 0.02, (point.z + next.z) / 2)
    road.rotation.y = angle
    road.scale.set(TRACK_WIDTH, 1, length)
    road.receiveShadow = true
    group.add(road)

    const sideX = Math.cos(angle)
    const sideZ = -Math.sin(angle)
    for (const side of [-1, 1]) {
      const edge = new THREE.Mesh(edgeGeometry, edgeMaterials[index % 2])
      edge.position.set(
        road.position.x + sideX * side * (TRACK_WIDTH / 2 + 0.25),
        0.28,
        road.position.z + sideZ * side * (TRACK_WIDTH / 2 + 0.25),
      )
      edge.rotation.y = angle
      edge.scale.set(1, 1, length)
      edge.castShadow = true
      group.add(edge)
    }
  })

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
  const treeCount = 40
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, treeCount)
  const crowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, treeCount)
  const matrix = new THREE.Matrix4()
  for (let index = 0; index < treeCount; index += 1) {
    const angle = (index / treeCount) * Math.PI * 2 + (index % 3) * 0.09
    const radiusX = index % 2 === 0 ? 63 : 34
    const radiusZ = index % 2 === 0 ? 43 : 18
    const x = Math.cos(angle) * radiusX
    const z = Math.sin(angle) * radiusZ
    matrix.makeTranslation(x, 1.1, z)
    trunks.setMatrixAt(index, matrix)
    matrix.makeTranslation(x, 3.4, z)
    crowns.setMatrixAt(index, matrix)
  }
  trunks.castShadow = true
  crowns.castShadow = true
  group.add(trunks, crowns)

  const standMaterial = new THREE.MeshStandardMaterial({ color: 0x6d6ae8, roughness: 0.75 })
  const standGeometry = new THREE.BoxGeometry(17, 4, 6)
  const stand = new THREE.Mesh(standGeometry, standMaterial)
  stand.position.set(18, 2, -45)
  stand.rotation.y = -0.25
  stand.castShadow = true
  group.add(stand)

  return {
    group,
    dispose: () => {
      roadGeometry.dispose()
      roadMaterial.dispose()
      edgeGeometry.dispose()
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
