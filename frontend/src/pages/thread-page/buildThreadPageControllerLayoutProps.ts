import { buildThreadPageControllerComposerLayoutInput } from './buildThreadPageControllerComposerLayoutInput'
import { buildThreadPageControllerRailLayoutInput } from './buildThreadPageControllerRailLayoutInput'
import { buildThreadPageControllerSurfaceLayoutInput } from './buildThreadPageControllerSurfaceLayoutInput'
import { buildThreadPageLayoutProps } from './buildThreadPageLayoutProps'
import type { BuildThreadPageLayoutPropsInput } from './threadPageLayoutPropTypes'
import type { BuildThreadPageControllerLayoutPropsInput } from './threadPageControllerLayoutTypes'

export function buildThreadPageControllerLayoutProps(
  input: BuildThreadPageControllerLayoutPropsInput,
) {
  const { controllerState, railState, statusState } = input
  const layoutInput: BuildThreadPageLayoutPropsInput = {
    ...buildThreadPageControllerComposerLayoutInput(input),
    ...buildThreadPageControllerSurfaceLayoutInput(input),
    ...buildThreadPageControllerRailLayoutInput(input),
  }

  const {
    composerDockProps,
    confirmDialogProps,
    railProps,
    surfaceProps,
    terminalDockProps,
  } = buildThreadPageLayoutProps(layoutInput)

  return {
    closeWorkbenchOverlay: railState.handleCloseWorkbenchOverlay,
    composerDockProps,
    confirmDialogProps,
    isMobileViewport: controllerState.isMobileViewport,
    isMobileWorkbenchOverlayOpen: statusState.isMobileWorkbenchOverlayOpen,
    railProps,
    surfaceProps,
    terminalDockProps,
    workbenchLayoutStyle: controllerState.workbenchLayoutStyle,
  }
}
