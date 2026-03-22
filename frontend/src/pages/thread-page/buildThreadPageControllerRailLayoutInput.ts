import { buildThreadPageControllerRailActionLayoutInput } from './buildThreadPageControllerRailActionLayoutInput'
import { buildThreadPageControllerRailStateLayoutInput } from './buildThreadPageControllerRailStateLayoutInput'
import type { BuildThreadPageControllerLayoutPropsInput } from './threadPageControllerLayoutTypes'
import type { ControllerRailLayoutInput } from './threadPageControllerLayoutInputTypes'

export function buildThreadPageControllerRailLayoutInput(
  input: BuildThreadPageControllerLayoutPropsInput,
): ControllerRailLayoutInput {
  return {
    ...buildThreadPageControllerRailStateLayoutInput(input),
    ...buildThreadPageControllerRailActionLayoutInput(input),
  }
}
