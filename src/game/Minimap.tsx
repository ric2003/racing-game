import { useMemo } from 'react'
import type { KartSnapshot, ServerMessage } from '../shared/protocol.js'
import { DEFAULT_TRACK, getTrack, getTrackBounds } from '../shared/track.js'

interface MinimapProps {
  snapshot: Extract<ServerMessage, { type: 'snapshot' }>
  playerId: string
}

export function Minimap({ snapshot, playerId }: MinimapProps) {
  const track = getTrack(snapshot.settings?.trackId ?? DEFAULT_TRACK.id)
  const { project, path } = useMemo(() => {
    const frame = getTrackBounds(track)
    const width = Math.max(1, frame.maxX - frame.minX)
    const height = Math.max(1, frame.maxZ - frame.minZ)
    const pad = 8
    const viewWidth = 200
    const viewHeight = 160
    const project = (x: number, z: number) => ({
      x: pad + ((x - frame.minX) / width) * (viewWidth - pad * 2),
      y: pad + ((frame.maxZ - z) / height) * (viewHeight - pad * 2),
    })
    const path = track.points.map((point) => {
      const projected = project(point.x, point.z)
      return `${projected.x.toFixed(1)},${projected.y.toFixed(1)}`
    }).join(' ')
    return { project, path }
  }, [track])

  return (
    <aside className="minimap glass-panel" aria-label={`${track.name} minimap`}>
      <span>TRACK MAP</span>
      <svg viewBox="0 0 200 160" role="img" aria-label="Track outline and racer positions">
        <polyline className="minimap-track" points={`${path} ${path.split(' ')[0]}`} />
        {snapshot.karts.map((kart: KartSnapshot) => {
          const projected = project(kart.x, kart.z)
          return <circle key={kart.id} className={kart.id === playerId ? 'minimap-dot is-you' : 'minimap-dot'} cx={projected.x} cy={projected.y} r={kart.id === playerId ? 4 : 3} style={{ fill: `#${kart.color.toString(16).padStart(6, '0')}` }} />
        })}
      </svg>
    </aside>
  )
}
