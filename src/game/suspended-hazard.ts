import * as THREE from 'three'
import { TRACK_WIDTH } from '../shared/constants.js'
import { nearestTrackPoint, type HazardDefinition, type TrackDefinition } from '../shared/track.js'
import type { ModelLibrary } from './models.js'

/** A fixed roadside gantry with a constant-length pendulum driven by server X/Z. */
export function createSuspendedHazard(hazard: HazardDefinition, track: TrackDefinition, models?: ModelLibrary) {
  const projection = nearestTrackPoint(hazard, track)
  const group = new THREE.Group()
  group.name = `hazard-${hazard.id}`
  group.position.set(projection.x, 0, projection.z)
  group.rotation.y = Math.atan2(projection.tangentX, projection.tangentZ)
  const steel = new THREE.MeshStandardMaterial({ color: 0x465360, metalness: 0.65, roughness: 0.5 })
  const orange = new THREE.MeshStandardMaterial({ color: 0xef982c, roughness: 0.65 })
  const concrete = new THREE.MeshStandardMaterial({ color: 0xa6aaa4, roughness: 0.95 })
  const cableMaterial = new THREE.MeshStandardMaterial({ color: 0x242c34, metalness: 0.8, roughness: 0.5 })
  const box = new THREE.BoxGeometry(1, 1, 1)
  const cableGeometry = new THREE.CylinderGeometry(0.065, 0.065, 1, 8)
  const eyeGeometry = new THREE.TorusGeometry(0.2, 0.07, 8, 16)
  const fallbackGeometry = models ? null : new THREE.SphereGeometry(1, 24, 16)
  const anchorHeight = 14
  const length = anchorHeight - hazard.radius - 0.18

  function beam(name: string, x: number, y: number, z: number, width: number, height: number, depth: number, material: THREE.Material) {
    const mesh = new THREE.Mesh(box, material)
    mesh.name = name
    mesh.position.set(x, y, z)
    mesh.scale.set(width, height, depth)
    mesh.castShadow = mesh.receiveShadow = true
    group.add(mesh)
    return mesh
  }

  function supportOffset(side: number) {
    // Check against the full circuit, including a neighboring section of road.
    for (let distance = TRACK_WIDTH / 2 + 4; distance < 100; distance += 1) {
      const point = { x: projection.x + projection.tangentZ * side * distance, z: projection.z - projection.tangentX * side * distance }
      if (nearestTrackPoint(point, track).distance > TRACK_WIDTH / 2 + 2.6) return side * distance
    }
    throw new Error(`No clear support position for ${hazard.id}`)
  }
  const left = supportOffset(-1)
  const right = supportOffset(1)
  for (const x of [left, right]) {
    beam('gantry-foot', x, 0.25, 0, 3, 0.5, 3, concrete)
    beam('gantry-post', x, anchorHeight / 2, 0, 0.9, anchorHeight, 1, steel)
    beam('gantry-post-marker', x, 1.6, 0, 1, 2.2, 1.1, orange)
  }
  beam('gantry-crossbeam', (left + right) / 2, anchorHeight + 0.5, 0, right - left + 1.5, 1, 1.1, steel)
  beam('suspension-mount', 0, anchorHeight + 0.05, 0, 1.1, 0.6, 1.3, orange)

  // Keep the sign within the foundation's width, clear of the road.
  let signTexture: THREE.CanvasTexture | undefined
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = 768
    canvas.height = 512
    const context = canvas.getContext('2d')
    if (context) {
      context.fillStyle = '#efb943'
      context.fillRect(0, 0, 768, 512)
      context.strokeStyle = '#252c34'
      context.lineWidth = 16
      context.strokeRect(20, 20, 728, 472)
      context.fillStyle = '#252c34'
      context.textAlign = 'center'
      context.font = 'bold 106px sans-serif'
      context.fillText('Oops,', 384, 156)
      context.font = 'bold 76px sans-serif'
      context.fillText('who left', 384, 286)
      context.fillText('this here?', 384, 398)
      signTexture = new THREE.CanvasTexture(canvas)
      signTexture.colorSpace = THREE.SRGBColorSpace
    }
  }
  const signMaterial = new THREE.MeshBasicMaterial({ map: signTexture ?? null, color: signTexture ? 0xffffff : 0xefb943 })
  const signGeometry = new THREE.PlaneGeometry(3, 2)
  beam('warning-sign-backing', right, 3.7, -0.7, 3.1, 2.1, 0.12, steel)
  const sign = new THREE.Mesh(signGeometry, signMaterial)
  sign.name = 'Oops, who left this here?'
  sign.position.set(right, 3.7, -0.77)
  sign.rotation.y = Math.PI
  group.add(sign)

  const pivot = new THREE.Group()
  pivot.name = 'pendulum-pivot'
  pivot.position.y = anchorHeight
  group.add(pivot)
  const ball = models ? models.clone('cannonball') : new THREE.Group()
  ball.name = 'suspended-cannonball'
  if (fallbackGeometry) {
    const sphere = new THREE.Mesh(fallbackGeometry, steel)
    sphere.castShadow = sphere.receiveShadow = true
    ball.add(sphere)
  }
  const size = new THREE.Box3().setFromObject(ball).getSize(new THREE.Vector3())
  ball.scale.setScalar(hazard.radius * 2 / Math.max(size.x, size.y, size.z))
  ball.position.y = -length
  pivot.add(ball)
  const cableLength = length - hazard.radius
  const cable = new THREE.Mesh(cableGeometry, cableMaterial)
  cable.name = 'suspension-cable'
  cable.position.y = -cableLength / 2
  cable.scale.y = cableLength
  cable.castShadow = true
  pivot.add(cable)
  const eye = new THREE.Mesh(eyeGeometry, steel)
  eye.name = 'ball-attachment-eye'
  eye.position.y = -cableLength
  eye.castShadow = true
  pivot.add(eye)

  const down = new THREE.Vector3(0, -1, 0)
  const direction = new THREE.Vector3()
  const targetRotation = new THREE.Quaternion()
  function update(x: number, z: number, delta = 0) {
    const dx = x - projection.x
    const dz = z - projection.z
    direction.set(dx * projection.tangentZ - dz * projection.tangentX, 0,
      dx * projection.tangentX + dz * projection.tangentZ)
    if (direction.length() >= length) direction.setLength(length - 0.001)
    direction.y = -Math.sqrt(length * length - direction.lengthSq())
    targetRotation.setFromUnitVectors(down, direction.normalize())
    // Frame-rate-independent damping avoids snapping at the 20 Hz snapshot rate.
    if (delta > 0) pivot.quaternion.slerp(targetRotation, 1 - Math.exp(-18 * delta))
    else pivot.quaternion.copy(targetRotation)
  }
  update(hazard.x, hazard.z)
  return {
    group, update,
    dispose: () => {
      box.dispose()
      cableGeometry.dispose()
      eyeGeometry.dispose()
      fallbackGeometry?.dispose()
      steel.dispose()
      orange.dispose()
      concrete.dispose()
      cableMaterial.dispose()
      signGeometry.dispose()
      signMaterial.dispose()
      signTexture?.dispose()
    },
  }
}
