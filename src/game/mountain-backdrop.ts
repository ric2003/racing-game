import * as THREE from 'three'
import { getTrackBounds, type TrackDefinition } from '../shared/track.js'

/** Distant scenery stays outside the entire circuit, including long layouts. */
export function createMountainBackdrop(track: TrackDefinition, skyColor: number, reducedMotion: boolean) {
  const group = new THREE.Group()
  group.name = 'mountain-backdrop'
  const fallback = new THREE.Group()
  fallback.name = 'procedural-volcano'
  group.add(fallback)
  const bounds = getTrackBounds(track)
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerZ = (bounds.minZ + bounds.maxZ) / 2
  const trackRadius = Math.hypot(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2
  const radius = trackRadius + 900
  const size = 320 + trackRadius * 0.2
  const sky = new THREE.Color(skyColor)
  const forest = !track.theme || track.theme === 'forest'
  const base = new THREE.Color(forest ? 0x426548 : track.theme === 'desert' ? 0x9c775c : 0x57767b)
  const rock = new THREE.Color(forest ? 0x64747a : 0x827a72)
  const geometries: THREE.BufferGeometry[] = []
  const materials: THREE.Material[] = []
  const mountainMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false })
  materials.push(mountainMaterial)

  function mountain(x: number, z: number, width: number, height: number, seed: number, volcano = false) {
    const segments = 15
    const levels = volcano ? [0, 0.34, 0.65, 1] : [0, 0.28, 0.6, 1]
    const positions: number[] = []
    const colors: number[] = []
    const vertices: THREE.Vector3[][] = []
    for (let ring = 0; ring < levels.length; ring++) {
      vertices.push([])
      for (let i = 0; i < segments; i++) {
        const angle = i / segments * Math.PI * 2
        const irregularity = 1 + Math.sin(i * 7.3 + seed) * 0.16
        const taper = volcano ? [1, 0.67, 0.4, 0.16][ring] : [1, 0.72, 0.39, 0.015][ring]
        const y = levels[ring] * height * (ring === 3 ? 1 : 1 + Math.sin(i * 3.7 + seed) * 0.12)
        vertices[ring].push(new THREE.Vector3(Math.cos(angle) * width * taper * irregularity,
          y - 12, Math.sin(angle) * width * taper * irregularity))
      }
    }
    for (let ring = 0; ring < 3; ring++) {
      for (let i = 0; i < segments; i++) {
        const next = (i + 1) % segments
        for (const triangle of [[vertices[ring][i], vertices[ring + 1][i], vertices[ring][next]],
          [vertices[ring][next], vertices[ring + 1][i], vertices[ring + 1][next]]]) {
          const shade = 0.82 + 0.18 * Math.cos(i / segments * Math.PI * 2 + 0.7)
          const color = base.clone().lerp(volcano ? new THREE.Color(0x49464b) : rock,
            volcano ? ring * 0.45 : ring * 0.3).multiplyScalar(shade).lerp(sky, volcano ? 0.16 : 0.35)
          for (const vertex of triangle) {
            positions.push(vertex.x, vertex.y, vertex.z)
            colors.push(color.r, color.g, color.b)
          }
        }
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geometry.computeBoundingSphere()
    geometries.push(geometry)
    const mesh = new THREE.Mesh(geometry, mountainMaterial)
    mesh.name = volcano ? 'volcano' : 'green-mountain'
    mesh.position.set(x, 0, z)
    if (volcano) fallback.add(mesh)
    else group.add(mesh)
    return vertices
  }

  const start = track.checkpoints[0]
  const volcanoAngle = Math.atan2(start.normalZ, start.normalX) + 0.32
  for (let i = 0; i < 22; i++) {
    const angle = volcanoAngle + (i + 1) / 22 * Math.PI * 2
    // Leave the volcano's silhouette free of competing peaks.
    if ((!track.theme || track.theme === 'forest') && (i === 0 || i >= 20)) continue
    mountain(centerX + Math.cos(angle) * radius, centerZ + Math.sin(angle) * radius,
      size * (0.85 + 0.25 * Math.sin(i * 4.3)), size * (0.14 + 0.1 * Math.abs(Math.sin(i * 2.1))), i)
  }
  if (track.theme === 'harbor' || track.theme === 'desert') {
    group.remove(fallback)
    return {
      group,
      setVolcano: () => { /* Harbor and desert maps only use the mountain range. */ },
      far: radius * 2 + size * 3,
      update: () => { /* No animated landmark on harbor or desert maps. */ },
      dispose: () => {
        geometries.forEach(geometry => geometry.dispose())
        materials.forEach(material => material.dispose())
      },
    }
  }
  const vx = centerX + Math.cos(volcanoAngle) * radius
  const vz = centerZ + Math.sin(volcanoAngle) * radius
  const volcanoWidth = size * 0.85
  const volcanoHeight = size * 0.30
  // Overlapping foothills cover the island's straight shoreline and connect it to the range.
  for (let i = -2; i <= 2; i++) {
    const angle = volcanoAngle + i * 0.16
    mountain(centerX + Math.cos(angle) * (radius - size * 0.28),
      centerZ + Math.sin(angle) * (radius - size * 0.28),
      size * 0.58, size * (0.09 + Math.abs(i) * 0.012), 31 + i)
  }
  const rings = mountain(vx, vz, volcanoWidth, volcanoHeight, 12, true)
  const lavaMaterial = new THREE.MeshBasicMaterial({ color: 0xff7930, fog: false, side: THREE.DoubleSide })
  materials.push(lavaMaterial)
  const craterGeometry = new THREE.CircleGeometry(volcanoWidth * 0.145, 15)
  geometries.push(craterGeometry)
  const crater = new THREE.Mesh(craterGeometry, lavaMaterial)
  crater.name = 'glowing-crater'
  crater.rotation.x = -Math.PI / 2
  crater.position.set(vx, volcanoHeight - 15, vz)
  fallback.add(crater)
  // Narrow lava streams follow the actual slope vertices on several faces.
  for (const sector of [2, 6, 10, 13]) {
    const path = [rings[3][sector], rings[2][sector], rings[1][sector]]
      .map(p => p.clone().add(new THREE.Vector3(0, 1.5, 0)))
    const geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path), 8, size * 0.006, 4, false)
    geometries.push(geometry)
    const stream = new THREE.Mesh(geometry, lavaMaterial)
    stream.position.set(vx, 0, vz)
    fallback.add(stream)
  }
  const smokeGeometry = new THREE.IcosahedronGeometry(1, 1)
  geometries.push(smokeGeometry)
  const smoke = Array.from({ length: 10 }, (_, i) => {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x56545d).lerp(sky, 0.2),
      transparent: true, opacity: 0.5, depthWrite: false, fog: false })
    materials.push(material)
    const puff = new THREE.Mesh(smokeGeometry, material)
    puff.name = `volcano-smoke-${i}`
    group.add(puff)
    return puff
  })
  const smokeOrigin = new THREE.Vector3(vx, volcanoHeight - 10, vz)
  function update(time: number) {
    const t = reducedMotion ? 0 : time
    smoke.forEach((puff, i) => {
      const age = (i / smoke.length + t * 0.022) % 1
      puff.position.set(smokeOrigin.x + age * size * 0.2, smokeOrigin.y + age * size * 0.22,
        smokeOrigin.z + Math.sin(age * 3) * size * 0.06)
      puff.scale.setScalar(size * (0.015 + age * 0.04))
      puff.material.opacity = Math.sin(age * Math.PI) * 0.58
    })
    lavaMaterial.color.setRGB(1, 0.26 + Math.sin(t * 1.3) * 0.045, 0.055)
  }
  update(0)
  return {
    group,
    setVolcano: (island: THREE.Group) => {
      const box = new THREE.Box3().setFromObject(island)
      const dimensions = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      // Preserve the source proportions, including the authored plume.
      const scale = Math.min(volcanoWidth * 2 / Math.max(dimensions.x, dimensions.z),
        size * 0.45 / dimensions.y)
      const placement = new THREE.Group()
      placement.name = 'volcano-island-placement'
      island.position.sub(new THREE.Vector3(center.x, box.min.y, center.z))
      placement.add(island)
      placement.scale.setScalar(scale)
      // Bury the beach and cut-away underside beneath the horizon.
      placement.position.set(vx, -dimensions.y * scale * 0.28, vz)
      island.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          // A little atmospheric haze joins the textured asset to the distant hills.
          material.onBeforeCompile = (shader: Parameters<THREE.Material['onBeforeCompile']>[0]) => {
            shader.uniforms.landmarkHaze = { value: sky }
            shader.fragmentShader = 'uniform vec3 landmarkHaze;\n' + shader.fragmentShader
            shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>',
              'outgoingLight = mix(outgoingLight, landmarkHaze, 0.32);\n#include <opaque_fragment>')
          }
          material.needsUpdate = true
        }
      })
      group.add(placement)
      placement.updateMatrixWorld(true)
      // The authored summit is offset from the island's bounding-box center.
      // Average its upper rim after placement, so smoke starts at the real crater.
      const summit: THREE.Vector3[] = []
      let highest = -Infinity
      island.traverse(node => {
        if (!(node instanceof THREE.Mesh) || !node.name.includes('Volcano_Base')) return
        const positions = node.geometry.getAttribute('position')
        for (let i = 0; i < positions.count; i++) {
          const point = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(node.matrixWorld)
          highest = Math.max(highest, point.y)
          summit.push(point)
        }
      })
      const rim = summit.filter(point => point.y >= highest - size * 0.004)
      if (rim.length) {
        smokeOrigin.set(0, 0, 0)
        rim.forEach(point => smokeOrigin.add(point))
        smokeOrigin.divideScalar(rim.length)
        group.worldToLocal(smokeOrigin)
      }
      update(0)
      fallback.visible = false
    },
    far: radius * 2 + size * 3,
    update,
    dispose: () => {
      geometries.forEach(geometry => geometry.dispose())
      materials.forEach(material => material.dispose())
    },
  }
}
