import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { TRACKS, nearestTrackPoint } from '../../src/shared/track.js'

it('uses all supplied free models and keeps every desert placement clear of the road', async () => {
  const manifest = JSON.parse(await readFile('public/assets/desert/desert-scenery.json', 'utf8'))
  const track = TRACKS.find(track => track.id === manifest.track)!
  const used = new Set(manifest.placements.map((p: { pack: string; model: string }) => `${p.pack}/${p.model}`))
  expect([...used].filter(name => String(name).startsWith('western/'))).toHaveLength(30)
  expect([...used].filter(name => String(name).startsWith('oasis/'))).toHaveLength(25)
  for (const p of manifest.placements) {
    expect(nearestTrackPoint(p, track).distance - p.radius).toBeGreaterThan(13)
  }
  expect(nearestTrackPoint(manifest.oasis, track).distance).toBeGreaterThan(60)
  const bytes = await readFile('public/assets/desert/desert-scenery.glb')
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString())
  const baked = new Set(gltf.nodes.filter((node: { extras?: { source_pack?: string } }) => node.extras?.source_pack)
    .map((node: { extras: { source_pack: string; source_model: string } }) => `${node.extras.source_pack}/${node.extras.source_model}`))
  expect(baked).toEqual(used)
})
