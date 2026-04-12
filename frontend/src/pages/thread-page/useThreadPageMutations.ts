import { useThreadPageBotMutations } from './useThreadPageBotMutations'
import { useThreadPageCommandMutations } from './useThreadPageCommandMutations'
import { useThreadPageThreadMutations } from './useThreadPageThreadMutations'
import type { ThreadPageMutationsInput } from './threadPageMutationTypes'

export function useThreadPageMutations(input: ThreadPageMutationsInput) {
  return {
    ...useThreadPageBotMutations(input),
    ...useThreadPageThreadMutations(input),
    ...useThreadPageCommandMutations(input),
  }
}
