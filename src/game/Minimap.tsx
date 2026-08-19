import type { KartSnapshot, ServerMessage } from '../shared/protocol.js'
import { DEFAULT_TRACK, getTrack } from '../shared/track.js'

interface MinimapProps {
  snapshot: Extract<ServerMessage, { type: 'snapshot' }>
  playerId: string
}

function bounds(points: Array<{ x: number; z: number }>) {
  const xs = points.map((point) => point.x)
  const zs = points.map((point) => point.z)
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  }
}

export function Minimap({ snapshot, playerId }: MinimapProps) {
  const track = getTrack(snapshot.settings?.trackId ?? DEFAULT_TRACK.id)
  const frame = bounds(track.points)
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

  return (
    <aside className="minimap glass-panel" aria-label={`${track.name} minimap`}>
      <span>TRACK MAP</span>
      <svg viewBox={`0 0 ${viewWidth} ${viewHeight}`} role="img" aria-label="Track outline and racer positions">
        <polyline className="minimap-track" points={`${path} ${path.split(' ')[0]}`} />
        {snapshot.karts.map((kart: KartSnapshot) => {
          const projected = project(kart.x, kart.z)
          return <circle key={kart.id} className={kart.id === playerId ? 'minimap-dot is-you' : 'minimap-dot'} cx={projected.x} cy={projected.y} r={kart.id === playerId ? 4 : 3} style={{ fill: `#${kart.color.toString(16).padStart(6, '0')}` }} />
        })}
      </svg>
    </aside>
  )
}
