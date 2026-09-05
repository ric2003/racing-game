import type { Standing } from '../shared/protocol.js'

export function selectCameraTarget(playerId: string, standings: Standing[]): string {
  const local = standings.find((standing) => standing.id === playerId)
  if (!local || (!local.finished && !local.eliminated)) return playerId
  return standings.find((standing) => !standing.finished && !standing.eliminated && standing.id !== playerId)?.id ?? playerId
}
