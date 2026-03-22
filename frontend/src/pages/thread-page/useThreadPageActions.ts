import { buildThreadPageCommandActions } from './buildThreadPageCommandActions'
import { buildThreadPageThreadActions } from './buildThreadPageThreadActions'
import type { ThreadPageActionsInput } from './threadPageActionTypes'

export function useThreadPageActions(input: ThreadPageActionsInput) {
  return {
    ...buildThreadPageThreadActions(input),
    ...buildThreadPageCommandActions(input),
  }
}
