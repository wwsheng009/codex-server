import type { SurfacePanelView } from '../../lib/layout-config'
import type { buildThreadPageControllerComposerActionLayoutInput } from './buildThreadPageControllerComposerActionLayoutInput'
import type { buildThreadPageControllerComposerStateLayoutInput } from './buildThreadPageControllerComposerStateLayoutInput'
import type { buildThreadPageControllerRailActionLayoutInput } from './buildThreadPageControllerRailActionLayoutInput'
import type { buildThreadPageControllerRailStateLayoutInput } from './buildThreadPageControllerRailStateLayoutInput'
import type { buildThreadPageControllerSurfaceActionLayoutInput } from './buildThreadPageControllerSurfaceActionLayoutInput'
import type { buildThreadPageControllerSurfaceStateLayoutInput } from './buildThreadPageControllerSurfaceStateLayoutInput'

export type ThreadPageComposerLayoutStateInput = ReturnType<
  typeof buildThreadPageControllerComposerStateLayoutInput
>

export type ThreadPageComposerLayoutActionInput = ReturnType<
  typeof buildThreadPageControllerComposerActionLayoutInput
>

export type BuildThreadPageComposerLayoutPropsInput =
  ThreadPageComposerLayoutStateInput & ThreadPageComposerLayoutActionInput

export type ThreadPageSurfaceLayoutStateInput = ReturnType<
  typeof buildThreadPageControllerSurfaceStateLayoutInput
>

export type ThreadPageSurfaceLayoutActionInput = ReturnType<
  typeof buildThreadPageControllerSurfaceActionLayoutInput
>

export type BuildThreadPageSurfaceLayoutPropsInput =
  ThreadPageSurfaceLayoutStateInput & ThreadPageSurfaceLayoutActionInput

export type ThreadPageRailLayoutStateInput = ReturnType<
  typeof buildThreadPageControllerRailStateLayoutInput
>

export type ThreadPageRailLayoutActionInput = ReturnType<
  typeof buildThreadPageControllerRailActionLayoutInput
>

export type BuildThreadPageRailLayoutPropsInput =
  ThreadPageRailLayoutStateInput &
    ThreadPageRailLayoutActionInput & {
      isMobileViewport: boolean
      onCloseWorkbenchOverlay: () => void
      surfacePanelView: SurfacePanelView | null
    }
