import type {
  ThreadPageComposerLayoutActionInput,
  ThreadPageComposerLayoutStateInput,
  ThreadPageRailLayoutActionInput,
  ThreadPageRailLayoutStateInput,
  ThreadPageSurfaceLayoutActionInput,
  ThreadPageSurfaceLayoutStateInput,
} from './threadPageLayoutInputTypes'

export type ControllerComposerStateLayoutInput = ThreadPageComposerLayoutStateInput

export type ControllerComposerActionLayoutInput = ThreadPageComposerLayoutActionInput

export type ControllerComposerLayoutInput =
  ControllerComposerStateLayoutInput & ControllerComposerActionLayoutInput

export type ControllerSurfaceStateLayoutInput = ThreadPageSurfaceLayoutStateInput

export type ControllerSurfaceActionLayoutInput = ThreadPageSurfaceLayoutActionInput

export type ControllerSurfaceLayoutInput =
  ControllerSurfaceStateLayoutInput & ControllerSurfaceActionLayoutInput

export type ControllerRailStateLayoutInput = ThreadPageRailLayoutStateInput

export type ControllerRailActionLayoutInput = ThreadPageRailLayoutActionInput

export type ControllerRailLayoutInput =
  ControllerRailStateLayoutInput & ControllerRailActionLayoutInput
