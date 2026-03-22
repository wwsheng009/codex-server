import { buildThreadPageControllerComposerActionLayoutInput } from './buildThreadPageControllerComposerActionLayoutInput'
import { buildThreadPageControllerComposerStateLayoutInput } from './buildThreadPageControllerComposerStateLayoutInput'
import type { BuildThreadPageControllerLayoutPropsInput } from './threadPageControllerLayoutTypes'
import type { ControllerComposerLayoutInput } from './threadPageControllerLayoutInputTypes'

export function buildThreadPageControllerComposerLayoutInput(
  input: BuildThreadPageControllerLayoutPropsInput,
): ControllerComposerLayoutInput {
  return {
    ...buildThreadPageControllerComposerStateLayoutInput(input),
    ...buildThreadPageControllerComposerActionLayoutInput(input),
  }
}
