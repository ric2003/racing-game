import * as THREE from 'three'
import type { HazardSnapshot, ItemBoxSnapshot, OilSlickSnapshot } from '../shared/protocol.js'
import { DEFAULT_TRACK, nearestTrackPoint, type TrackDefinition } from '../shared/track.js'
import { TRACK_WIDTH } from '../shared/constants.js'

export interface TrackVisual {
  group: THREE.Group
  update: (elapsedSeconds: number, serverTime: number, itemBoxes?: ItemBoxSnapshot[], hazards?: HazardSnapshot[], oilSlicks?: OilSlickSnapshot[]) => void
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
      // Vertices stay local so offset joins cannot fold across the road.
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

  const startLine = new THREE.Group()
  startLine.name = 'start-line'
  const start = track.checkpoints[0]
  const startColumns = 12
  const startRows = 2
  const startWidth = TRACK_WIDTH - 1
  const tileWidth = startWidth / startColumns
  const tileLength = 0.48
  const startTileGeometry = new THREE.BoxGeometry(tileWidth - 0.025, 0.035, tileLength - 0.025)
  const startMaterials = [
    new THREE.MeshStandardMaterial({ color: 0xf7f3e8, roughness: 0.72 }),
    new THREE.MeshStandardMaterial({ color: 0x242535, roughness: 0.82 }),
  ]
  for (let row = 0; row < startRows; row += 1) {
    for (let column = 0; column < startColumns; column += 1) {
      const tile = new THREE.Mesh(startTileGeometry, startMaterials[(row + column) % 2])
      tile.position.set(-startWidth / 2 + tileWidth * (column + 0.5), 0, (row - 0.5) * tileLength)
      tile.receiveShadow = true
      startLine.add(tile)
    }
  }
  startLine.position.set(start.x, 0.145, start.z)
  startLine.rotation.y = Math.atan2(start.normalX, start.normalZ)
  group.add(startLine)

  const itemShellGeometry = new THREE.BoxGeometry(1.3, 1.3, 1.3)
  const itemCoreGeometry = new THREE.OctahedronGeometry(0.44, 0)
  const itemRingGeometry = new THREE.TorusGeometry(0.9, 0.065, 6, 24)
  const itemShellMaterial = new THREE.MeshStandardMaterial({
    color: 0x56d9f3,
    emissive: 0x1b6c7b,
    emissiveIntensity: 1.15,
    transparent: true,
    opacity: 0.58,
    roughness: 0.24,
    metalness: 0.22,
    wireframe: true,
  })
  const itemCoreMaterial = new THREE.MeshStandardMaterial({ color: 0xf7f3e8, emissive: 0x56d9f3, emissiveIntensity: 1.5, roughness: 0.3 })
  const itemRingMaterial = new THREE.MeshBasicMaterial({ color: 0x56d9f3, transparent: true, opacity: 0.72 })
  const itemVisuals = track.itemBoxes.map((point, index) => {
    const visual = new THREE.Group()
    visual.name = `item-box-${index}`
    visual.position.set(point.x, 1.25, point.z)
    const shell = new THREE.Mesh(itemShellGeometry, itemShellMaterial)
    const core = new THREE.Mesh(itemCoreGeometry, itemCoreMaterial)
    const ring = new THREE.Mesh(itemRingGeometry, itemRingMaterial)
    ring.position.y = -0.76
    ring.rotation.x = Math.PI / 2
    shell.castShadow = true
    core.castShadow = true
    visual.add(shell, core, ring)
    group.add(visual)
    return visual
  })

  const padGeometry = new THREE.BoxGeometry(5.2, 0.08, 2.25)
  const padStripeGeometry = new THREE.BoxGeometry(4.25, 0.025, 0.16)
  const padMaterial = new THREE.MeshStandardMaterial({ color: 0xffc857, emissive: 0x8b5d09, emissiveIntensity: 0.85, roughness: 0.52 })
  const padStripeMaterial = new THREE.MeshBasicMaterial({ color: 0xf7f3e8 })
  const barrierGeometry = new THREE.BoxGeometry(4.2, 0.58, 0.46)
  const barrierPostGeometry = new THREE.BoxGeometry(0.22, 1.05, 0.22)
  const barrierMaterial = new THREE.MeshStandardMaterial({ color: 0xff4f70, emissive: 0x7b142b, emissiveIntensity: 0.62, roughness: 0.45 })
  const barrierStripeMaterial = new THREE.MeshStandardMaterial({ color: 0xf7f3e8, emissive: 0x6d5f4c, emissiveIntensity: 0.25, roughness: 0.58 })
  const hazardVisuals = new Map<string, THREE.Group>()
  for (const hazard of track.hazards) {
    const visual = new THREE.Group()
    visual.name = `hazard-${hazard.id}`
    visual.position.set(hazard.x, 0.12, hazard.z)
    const projection = nearestTrackPoint(hazard, track)
    visual.rotation.y = Math.atan2(projection.tangentX, projection.tangentZ)
    if (hazard.type === 'boost-pad') {
      const base = new THREE.Mesh(padGeometry, padMaterial)
      base.receiveShadow = true
      visual.add(base)
      for (const z of [-0.65, 0, 0.65]) {
        const stripe = new THREE.Mesh(padStripeGeometry, padStripeMaterial)
        stripe.position.set(0, 0.052, z)
        visual.add(stripe)
      }
    } else {
      const bar = new THREE.Mesh(barrierGeometry, barrierMaterial)
      bar.position.y = 0.92
      bar.castShadow = true
      visual.add(bar)
      for (const x of [-1.55, 0, 1.55]) {
        const stripe = new THREE.Mesh(barrierPostGeometry, barrierStripeMaterial)
        stripe.position.set(x, 0.92, 0.245)
        stripe.rotation.z = Math.PI / 4
        visual.add(stripe)
      }
      for (const x of [-1.9, 1.9]) {
        const post = new THREE.Mesh(barrierPostGeometry, barrierMaterial)
        post.position.set(x, 0.53, 0)
        post.castShadow = true
        visual.add(post)
      }
    }
    hazardVisuals.set(hazard.id, visual)
    group.add(visual)
  }

  const oilGeometry = new THREE.CylinderGeometry(1.5, 1.65, 0.07, 24)
  const oilRingGeometry = new THREE.TorusGeometry(1.35, 0.08, 6, 28)
  const oilMaterial = new THREE.MeshStandardMaterial({ color: 0x121019, emissive: 0x37194f, emissiveIntensity: 0.55, roughness: 0.28, metalness: 0.2 })
  const oilRingMaterial = new THREE.MeshBasicMaterial({ color: 0xc05cff, transparent: true, opacity: 0.9 })
  const oilVisuals = new Map<number, THREE.Group>()

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
  const itemState = new Map<number, ItemBoxSnapshot>()
  const hazardState = new Map<string, HazardSnapshot>()
  const activeSlicks = new Set<number>()

  return {
    group,
    update: (elapsedSeconds, serverTime, itemBoxes, hazards, oilSlicks) => {
      if (itemBoxes !== undefined) {
        itemState.clear()
        for (const item of itemBoxes) itemState.set(item.id, item)
        itemVisuals.forEach((visual, index) => {
          const state = itemState.get(index)
          visual.visible = state !== undefined && state.availableAt <= serverTime
        })
      }
      itemVisuals.forEach((visual, index) => {
        visual.position.y = 1.25 + Math.sin(elapsedSeconds * 2.2 + index * 0.8) * 0.18
        visual.rotation.y = elapsedSeconds * 1.25 + index * 0.7
        visual.children[1].rotation.x = elapsedSeconds * 1.8
      })
      if (hazards !== undefined) {
        hazardState.clear()
        for (const hazard of hazards) hazardState.set(hazard.id, hazard)
        for (const [id, visual] of hazardVisuals) {
          const state = hazardState.get(id)
          visual.visible = true
          if (state) visual.position.set(state.x, visual.position.y, state.z)
        }
      }

      activeSlicks.clear()
      for (const slick of oilSlicks ?? []) activeSlicks.add(slick.id)
      for (const [id, visual] of oilVisuals) {
        if (activeSlicks.has(id)) continue
        group.remove(visual)
        oilVisuals.delete(id)
      }
      for (const slick of oilSlicks ?? []) {
        let visual = oilVisuals.get(slick.id)
        if (!visual) {
          visual = new THREE.Group()
          visual.name = `oil-slick-${slick.id}`
          const puddle = new THREE.Mesh(oilGeometry, oilMaterial)
          puddle.receiveShadow = true
          const warningRing = new THREE.Mesh(oilRingGeometry, oilRingMaterial)
          warningRing.position.y = 0.055
          warningRing.rotation.x = Math.PI / 2
          visual.add(puddle, warningRing)
          oilVisuals.set(slick.id, visual)
          group.add(visual)
        }
        visual.position.set(slick.x, 0.075, slick.z)
        const pulse = 1 + Math.sin(elapsedSeconds * 6 + slick.id) * 0.035
        visual.scale.setScalar(pulse)
      }
    },
    dispose: () => {
      roadGeometry.dispose()
      roadMaterial.dispose()
      leftCurbGeometry.dispose()
      rightCurbGeometry.dispose()
      edgeMaterials.forEach((material) => material.dispose())
      startTileGeometry.dispose()
      startMaterials.forEach((material) => material.dispose())
      trunkGeometry.dispose()
      crownGeometry.dispose()
      trunkMaterial.dispose()
      crownMaterial.dispose()
      standMaterial.dispose()
      standGeometry.dispose()
      itemShellGeometry.dispose()
      itemCoreGeometry.dispose()
      itemRingGeometry.dispose()
      itemShellMaterial.dispose()
      itemCoreMaterial.dispose()
      itemRingMaterial.dispose()
      padGeometry.dispose()
      padStripeGeometry.dispose()
      padMaterial.dispose()
      padStripeMaterial.dispose()
      barrierGeometry.dispose()
      barrierPostGeometry.dispose()
      barrierMaterial.dispose()
      barrierStripeMaterial.dispose()
      oilGeometry.dispose()
      oilRingGeometry.dispose()
      oilMaterial.dispose()
      oilRingMaterial.dispose()
    },
  }
}
