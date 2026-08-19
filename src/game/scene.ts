import * as THREE from 'three'
import type { HazardSnapshot, ItemBoxSnapshot, KartSnapshot, OilSlickSnapshot, RaceEvent } from '../shared/protocol.js'
import { createKartMesh, type KartVisual } from './kart-mesh.js'
import { createTrackMesh } from './track-mesh.js'
import { DEFAULT_TRACK, type TrackDefinition } from '../shared/track.js'

export interface RenderKart extends KartSnapshot {
  correctionX?: number
  correctionZ?: number
  correctionHeading?: number
}

export interface TrackRenderState {
  serverTime: number
  itemBoxes?: ItemBoxSnapshot[]
  hazards?: HazardSnapshot[]
  oilSlicks?: OilSlickSnapshot[]
  events?: RaceEvent[]
}

interface TransientEffect {
  group: THREE.Group
  geometries: THREE.BufferGeometry[]
  material: THREE.MeshBasicMaterial
  age: number
  duration: number
  grows: boolean
}

export interface RaceScene {
  setAnimationLoop: (callback: ((time: number) => void) | null) => void
  render: (karts: RenderKart[], localId: string, delta: number, cameraId?: string, trackState?: TrackRenderState) => void
  resize: () => void
  dispose: () => void
}

export function createRaceScene(canvas: HTMLCanvasElement, reducedMotion: boolean, track: TrackDefinition = DEFAULT_TRACK): RaceScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x8fd4e8)
  scene.fog = new THREE.Fog(0x8fd4e8, 90, 260)
  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 340)
  camera.position.set(0, 10, -15)

  scene.add(new THREE.HemisphereLight(0xd9f5ff, 0x23462f, 2.4))
  const sun = new THREE.DirectionalLight(0xfff1d1, 3.2)
  sun.position.set(-50, 75, -40)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  sun.shadow.camera.left = -125
  sun.shadow.camera.right = 125
  sun.shadow.camera.top = 125
  sun.shadow.camera.bottom = -125
  sun.shadow.camera.far = 300
  scene.add(sun)

  const groundGeometry = new THREE.CircleGeometry(185, 72)
  const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x4baf69, roughness: 1 })
  const ground = new THREE.Mesh(groundGeometry, groundMaterial)
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.09
  ground.receiveShadow = true
  scene.add(ground)
  const trackVisual = createTrackMesh(track)
  scene.add(trackVisual.group)

  const kartVisuals = new Map<string, KartVisual>()
  const activeKartIds = new Set<string>()
  const cameraPosition = new THREE.Vector3()
  const cameraLookAt = new THREE.Vector3()
  const desiredCameraPosition = new THREE.Vector3()
  const desiredCameraLookAt = new THREE.Vector3()
  const transientEffects: TransientEffect[] = []
  let lastVisualEventId = 0
  let elapsedSeconds = 0
  let cameraHeading: number | null = null
  let followedKartId: string | null = null

  function addPickupEffect(kart: RenderKart) {
    const geometry = new THREE.TorusGeometry(1.35, 0.1, 6, 28)
    const material = new THREE.MeshBasicMaterial({ color: 0x56d9f3, transparent: true, opacity: 0.9, depthWrite: false })
    const ring = new THREE.Mesh(geometry, material)
    ring.position.set(kart.x + (kart.correctionX ?? 0), 1.15, kart.z + (kart.correctionZ ?? 0))
    ring.rotation.x = Math.PI / 2
    const effect = new THREE.Group()
    effect.add(ring)
    scene.add(effect)
    transientEffects.push({ group: effect, geometries: [geometry], material, age: 0, duration: 0.45, grows: true })
  }

  function addBoltEffect(source: RenderKart, target: RenderKart) {
    const start = new THREE.Vector3(source.x + (source.correctionX ?? 0), 1.25, source.z + (source.correctionZ ?? 0))
    const end = new THREE.Vector3(target.x + (target.correctionX ?? 0), 1.05, target.z + (target.correctionZ ?? 0))
    const direction = end.clone().sub(start)
    const length = Math.max(0.1, direction.length())
    const beamGeometry = new THREE.CylinderGeometry(0.11, 0.11, length, 8)
    const flashGeometry = new THREE.SphereGeometry(0.62, 12, 8)
    const material = new THREE.MeshBasicMaterial({ color: 0x79ecff, transparent: true, opacity: 1, depthWrite: false })
    const beam = new THREE.Mesh(beamGeometry, material)
    beam.position.copy(start).add(end).multiplyScalar(0.5)
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
    const flash = new THREE.Mesh(flashGeometry, material)
    flash.position.copy(end)
    const effect = new THREE.Group()
    effect.add(beam, flash)
    scene.add(effect)
    transientEffects.push({ group: effect, geometries: [beamGeometry, flashGeometry], material, age: 0, duration: 0.32, grows: false })
  }

  function updateTransientEffects(delta: number) {
    for (let index = transientEffects.length - 1; index >= 0; index -= 1) {
      const effect = transientEffects[index]
      effect.age += delta
      const progress = Math.min(1, effect.age / effect.duration)
      effect.material.opacity = 1 - progress
      if (effect.grows) effect.group.scale.setScalar(1 + progress * 1.8)
      if (progress < 1) continue
      scene.remove(effect.group)
      effect.geometries.forEach((geometry) => geometry.dispose())
      effect.material.dispose()
      transientEffects.splice(index, 1)
    }
  }

  function resize() {
    const width = Math.max(1, canvas.clientWidth)
    const height = Math.max(1, canvas.clientHeight)
    if (canvas.width !== Math.floor(width * renderer.getPixelRatio()) || canvas.height !== Math.floor(height * renderer.getPixelRatio())) {
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
  }

  function render(karts: RenderKart[], localId: string, delta: number, cameraId = localId, trackState?: TrackRenderState) {
    elapsedSeconds += delta
    const serverTime = trackState?.serverTime ?? performance.now()
    trackVisual.update(elapsedSeconds, serverTime, trackState?.itemBoxes, trackState?.hazards, trackState?.oilSlicks)
    activeKartIds.clear()
    for (const kart of karts) activeKartIds.add(kart.id)
    for (const [id, visual] of kartVisuals) {
      if (!activeKartIds.has(id)) {
        scene.remove(visual.group)
        visual.dispose()
        kartVisuals.delete(id)
      }
    }
    for (const kart of karts) {
      let visual = kartVisuals.get(kart.id)
      if (!visual) {
        visual = createKartMesh(kart.color)
        kartVisuals.set(kart.id, visual)
        scene.add(visual.group)
      }
      visual.group.position.set(kart.x + (kart.correctionX ?? 0), 0.08, kart.z + (kart.correctionZ ?? 0))
      visual.group.rotation.y = kart.heading + (kart.correctionHeading ?? 0)
      visual.updateEffects(kart, serverTime, elapsedSeconds)
      const speed = Math.hypot(kart.vx, kart.vz)
      for (const wheel of visual.wheels) wheel.rotation.x -= speed * delta * 1.9
    }

    for (const event of trackState?.events ?? []) {
      if (event.id <= lastVisualEventId) continue
      lastVisualEventId = event.id
      if (serverTime - event.at > 900) continue
      const source = karts.find((kart) => kart.id === event.playerId)
      const target = event.targetId ? karts.find((kart) => kart.id === event.targetId) : undefined
      if (event.kind === 'item-pickup' && source) addPickupEffect(source)
      if ((event.kind === 'spin' || event.kind === 'item-hit') && event.item === 'pulse-bolt' && source && target) addBoltEffect(source, target)
    }
    updateTransientEffects(delta)

    const cameraKart = karts.find((kart) => kart.id === cameraId) ?? karts.find((kart) => kart.id === localId)
    if (cameraKart) {
      if (followedKartId !== cameraKart.id || cameraHeading === null) {
        followedKartId = cameraKart.id
        cameraHeading = cameraKart.heading
      }
      const headingResponse = reducedMotion ? 1 : 1 - Math.exp(-10 * delta)
      const headingDelta = Math.atan2(Math.sin(cameraKart.heading - cameraHeading), Math.cos(cameraKart.heading - cameraHeading))
      cameraHeading += headingDelta * headingResponse
      const forwardX = Math.sin(cameraHeading)
      const forwardZ = Math.cos(cameraHeading)
      desiredCameraPosition.set(cameraKart.x - forwardX * 11, 7.1, cameraKart.z - forwardZ * 11)
      desiredCameraLookAt.set(cameraKart.x + forwardX * 4, 1.1, cameraKart.z + forwardZ * 4)
      const response = reducedMotion ? 1 : 1 - Math.exp(-7 * delta)
      cameraPosition.copy(camera.position).lerp(desiredCameraPosition, response)
      camera.position.copy(cameraPosition)
      cameraLookAt.lerp(desiredCameraLookAt, response)
      camera.lookAt(cameraLookAt)
      const speed = Math.hypot(cameraKart.vx, cameraKart.vz)
      camera.fov += ((58 + Math.min(10, speed * 0.25)) - camera.fov) * response
      camera.updateProjectionMatrix()
    }
    resize()
    renderer.render(scene, camera)
  }

  return {
    setAnimationLoop: (callback) => renderer.setAnimationLoop(callback),
    render,
    resize,
    dispose: () => {
      renderer.setAnimationLoop(null)
      for (const visual of kartVisuals.values()) visual.dispose()
      kartVisuals.clear()
      for (const effect of transientEffects) {
        effect.geometries.forEach((geometry) => geometry.dispose())
        effect.material.dispose()
      }
      transientEffects.length = 0
      trackVisual.dispose()
      groundGeometry.dispose()
      groundMaterial.dispose()
      renderer.dispose()
    },
  }
}
