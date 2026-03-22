import { buildThreadPageControllerSurfaceActionLayoutInput } from './buildThreadPageControllerSurfaceActionLayoutInput'
import { buildThreadPageControllerSurfaceStateLayoutInput } from './buildThreadPageControllerSurfaceStateLayoutInput'
import type { BuildThreadPageControllerLayoutPropsInput } from './threadPageControllerLayoutTypes'
import type { ControllerSurfaceLayoutInput } from './threadPageControllerLayoutInputTypes'

export function buildThreadPageControllerSurfaceLayoutInput(
  input: BuildThreadPageControllerLayoutPropsInput,
): ControllerSurfaceLayoutInput {
  return {
    ...buildThreadPageControllerSurfaceStateLayoutInput(input),
    ...buildThreadPageControllerSurfaceActionLayoutInput(input),
  }
}
