import { buildThreadPageBotActions } from './buildThreadPageBotActions'
import { buildThreadPageCommandActions } from './buildThreadPageCommandActions'
import { buildThreadPageThreadActions } from './buildThreadPageThreadActions'
import type { ThreadPageActionsInput } from './threadPageActionTypes'

export function useThreadPageActions(input: ThreadPageActionsInput) {
  return {
    ...buildThreadPageBotActions(input),
    ...buildThreadPageThreadActions(input),
    ...buildThreadPageCommandActions(input),
  }
}
