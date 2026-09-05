import type { Point2 } from './track.js'

// Independent route layouts, scaled and sampled by distance in track.ts.
export const LONG_LAYOUTS = [
  {
    id: 'forest-run', name: 'Forest Run', theme: 'forest' as const,
    anchors: [
      [-40, -70], [0, -70], [40, -65], [65, -45], [70, -15],
      [45, 0], [60, 25], [85, 45], [70, 75], [35, 85],
      [10, 65], [-5, 35], [-30, 30], [-45, 55], [-70, 70],
      [-90, 45], [-80, 10], [-55, -5], [-75, -30], [-70, -55],
    ],
  },
  {
    id: 'harbor-grand-prix', name: 'Harbor Grand Prix', theme: 'harbor' as const,
    anchors: [
      [-70, -65], [-20, -65], [35, -65], [85, -60], [105, -40],
      [100, -10], [70, 0], [40, -15], [20, 0], [30, 25],
      [70, 30], [95, 45], [90, 70], [55, 80], [0, 80],
      [-55, 80], [-85, 65], [-90, 35], [-65, 15], [-40, 20],
      [-25, 0], [-45, -20], [-80, -25], [-95, -45],
    ],
  },
  {
    id: 'desert-endurance', name: 'Desert Endurance', theme: 'desert' as const,
    anchors: [
      [-40, -90], [5, -90], [50, -80], [95, -50], [110, -10],
      [90, 25], [60, 20], [50, -5], [25, -15], [10, 10],
      [35, 45], [50, 80], [25, 100], [-15, 95], [-45, 70],
      [-35, 40], [-55, 20], [-85, 35], [-110, 15], [-105, -20],
      [-80, -45], [-90, -70], [-70, -90],
    ],
  },
].map((layout) => ({ ...layout, anchors: layout.anchors.map(([x, z]): Point2 => ({ x, z })) }))
