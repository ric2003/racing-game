import * as THREE from 'three'
import type { KartSnapshot } from '../shared/protocol.js'

export interface KartVisual {
  group: THREE.Group
  wheels: THREE.Mesh[]
  updateEffects: (kart: KartSnapshot, serverTime: number, elapsedSeconds: number) => void
  dispose: () => void
}

export function createKartMesh(color: number): KartVisual {
  const group = new THREE.Group()
  const bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.08 })
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x171821, roughness: 0.8 })
  const lightMaterial = new THREE.MeshStandardMaterial({ color: 0xf7f1d0, emissive: 0x665f35, emissiveIntensity: 0.7 })
  const bodyGeometry = new THREE.BoxGeometry(2.25, 0.65, 3.1)
  const noseGeometry = new THREE.BoxGeometry(1.8, 0.45, 1.15)
  const seatGeometry = new THREE.BoxGeometry(1.25, 0.8, 1.05)
  const wheelGeometry = new THREE.CylinderGeometry(0.45, 0.45, 0.4, 12)
  const lightGeometry = new THREE.BoxGeometry(0.42, 0.18, 0.12)
  const shieldGeometry = new THREE.SphereGeometry(1.8, 20, 12)
  const flameGeometry = new THREE.ConeGeometry(0.3, 1.4, 8)
  const statusGeometry = new THREE.TorusGeometry(1.25, 0.09, 6, 28)
  const shieldMaterial = new THREE.MeshBasicMaterial({ color: 0x56d9f3, transparent: true, opacity: 0.2, wireframe: true, depthWrite: false })
  const flameMaterial = new THREE.MeshBasicMaterial({ color: 0xffc83d, transparent: true, opacity: 0.92 })
  const statusMaterial = new THREE.MeshBasicMaterial({ color: 0xff4f70, transparent: true, opacity: 0.9 })

  const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
  body.position.y = 0.65
  body.castShadow = true
  group.add(body)
  const nose = new THREE.Mesh(noseGeometry, bodyMaterial)
  nose.position.set(0, 0.72, 1.75)
  nose.castShadow = true
  group.add(nose)
  const seat = new THREE.Mesh(seatGeometry, darkMaterial)
  seat.position.set(0, 1.16, -0.35)
  seat.castShadow = true
  group.add(seat)

  const wheels: THREE.Mesh[] = []
  for (const x of [-1.18, 1.18]) {
    for (const z of [-1.02, 1.02]) {
      const wheel = new THREE.Mesh(wheelGeometry, darkMaterial)
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(x, 0.45, z)
      wheel.castShadow = true
      wheels.push(wheel)
      group.add(wheel)
    }
  }
  for (const x of [-0.58, 0.58]) {
    const light = new THREE.Mesh(lightGeometry, lightMaterial)
    light.position.set(x, 0.8, 2.35)
    group.add(light)
  }

  const shield = new THREE.Mesh(shieldGeometry, shieldMaterial)
  shield.position.y = 0.9
  shield.visible = false
  group.add(shield)

  const boostFlames = [-0.58, 0.58].map((x) => {
    const flame = new THREE.Mesh(flameGeometry, flameMaterial)
    flame.position.set(x, 0.62, -2.15)
    flame.rotation.x = -Math.PI / 2
    flame.visible = false
    group.add(flame)
    return flame
  })

  const disabledRing = new THREE.Mesh(statusGeometry, statusMaterial)
  disabledRing.position.y = 2.35
  disabledRing.rotation.x = Math.PI / 2
  disabledRing.visible = false
  group.add(disabledRing)

  return {
    group,
    wheels,
    updateEffects: (kart, serverTime, elapsedSeconds) => {
      const shieldedUntil = kart.shieldedUntil ?? kart.item?.shieldedUntil ?? 0
      const disabledUntil = kart.disabledUntil ?? kart.item?.disabledUntil ?? 0
      shield.visible = shieldedUntil > serverTime
      if (shield.visible) {
        const pulse = 1 + Math.sin(elapsedSeconds * 7) * 0.045
        shield.scale.setScalar(pulse)
        shield.rotation.y = elapsedSeconds * 0.8
      }
      const boosted = (kart.boostedUntil ?? 0) > serverTime
      boostFlames.forEach((flame, index) => {
        flame.visible = boosted
        if (boosted) flame.scale.set(1, 0.75 + Math.sin(elapsedSeconds * 24 + index) * 0.22, 1)
      })
      disabledRing.visible = disabledUntil > serverTime
      if (disabledRing.visible) {
        disabledRing.rotation.z = elapsedSeconds * 4
        disabledRing.scale.setScalar(1 + Math.sin(elapsedSeconds * 12) * 0.08)
      }
    },
    dispose: () => {
      bodyGeometry.dispose()
      noseGeometry.dispose()
      seatGeometry.dispose()
      wheelGeometry.dispose()
      lightGeometry.dispose()
      shieldGeometry.dispose()
      flameGeometry.dispose()
      statusGeometry.dispose()
      bodyMaterial.dispose()
      darkMaterial.dispose()
      lightMaterial.dispose()
      shieldMaterial.dispose()
      flameMaterial.dispose()
      statusMaterial.dispose()
    },
  }
}
