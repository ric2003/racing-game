import * as THREE from 'three'
import type { KartSnapshot } from '../shared/protocol.js'
import { createKartMesh, type KartVisual } from './kart-mesh.js'
import { createTrackMesh } from './track-mesh.js'
import { DEFAULT_TRACK, type TrackDefinition } from '../shared/track.js'

export interface RenderKart extends KartSnapshot {
  correctionX?: number
  correctionZ?: number
}

export interface RaceScene {
  setAnimationLoop: (callback: ((time: number) => void) | null) => void
  render: (karts: RenderKart[], localId: string, delta: number, cameraId?: string) => void
  resize: () => void
  dispose: () => void
}

export function createRaceScene(canvas: HTMLCanvasElement, reducedMotion: boolean, track: TrackDefinition = DEFAULT_TRACK): RaceScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
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
  sun.shadow.mapSize.set(2048, 2048)
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
  const cameraPosition = new THREE.Vector3()
  const cameraLookAt = new THREE.Vector3()

  function resize() {
    const width = Math.max(1, canvas.clientWidth)
    const height = Math.max(1, canvas.clientHeight)
    if (canvas.width !== Math.floor(width * renderer.getPixelRatio()) || canvas.height !== Math.floor(height * renderer.getPixelRatio())) {
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
  }

  function render(karts: RenderKart[], localId: string, delta: number, cameraId = localId) {
    const active = new Set(karts.map((kart) => kart.id))
    for (const [id, visual] of kartVisuals) {
      if (!active.has(id)) {
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
      visual.group.rotation.y = kart.heading
      const speed = Math.hypot(kart.vx, kart.vz)
      for (const wheel of visual.wheels) wheel.rotation.x -= speed * delta * 1.9
    }

    const cameraKart = karts.find((kart) => kart.id === cameraId) ?? karts.find((kart) => kart.id === localId)
    if (cameraKart) {
      const forwardX = Math.sin(cameraKart.heading)
      const forwardZ = Math.cos(cameraKart.heading)
      const desired = new THREE.Vector3(cameraKart.x - forwardX * 11, 7.1, cameraKart.z - forwardZ * 11)
      const look = new THREE.Vector3(cameraKart.x + forwardX * 4, 1.1, cameraKart.z + forwardZ * 4)
      const response = reducedMotion ? 1 : 1 - Math.exp(-7 * delta)
      cameraPosition.copy(camera.position).lerp(desired, response)
      camera.position.copy(cameraPosition)
      cameraLookAt.lerp(look, response)
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
      trackVisual.dispose()
      groundGeometry.dispose()
      groundMaterial.dispose()
      renderer.dispose()
    },
  }
}
