import * as THREE from 'three'

export interface KartVisual {
  group: THREE.Group
  wheels: THREE.Mesh[]
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

  return {
    group,
    wheels,
    dispose: () => {
      bodyGeometry.dispose()
      noseGeometry.dispose()
      seatGeometry.dispose()
      wheelGeometry.dispose()
      lightGeometry.dispose()
      bodyMaterial.dispose()
      darkMaterial.dispose()
      lightMaterial.dispose()
    },
  }
}
