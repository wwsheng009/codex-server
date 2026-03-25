import type { ThreadTurn } from '../../types/api'

export type FindThreadItemInput = {
  fullTurnItemOverridesById: Record<string, Record<string, unknown>>
  fullTurnOverridesById: Record<string, ThreadTurn>
  historicalTurns: ThreadTurn[]
  turns: ThreadTurn[]
}
