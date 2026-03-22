import { useThreadPageCommandMutations } from './useThreadPageCommandMutations'
import { useThreadPageThreadMutations } from './useThreadPageThreadMutations'
import type { ThreadPageMutationsInput } from './threadPageMutationTypes'

export function useThreadPageMutations(input: ThreadPageMutationsInput) {
  return {
    ...useThreadPageThreadMutations(input),
    ...useThreadPageCommandMutations(input),
  }
}
