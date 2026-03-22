import { useThreadComposerActions } from './useThreadComposerActions'
import { useThreadPageActions } from './useThreadPageActions'
import { useThreadPageComposerCallbacks } from './useThreadPageComposerCallbacks'
import { useThreadPageComposerPanelState } from './useThreadPageComposerPanelState'
import { useThreadPageControllerState } from './useThreadPageControllerState'
import { useThreadPageData } from './useThreadPageData'
import { useThreadPageDisplayState } from './useThreadPageDisplayState'
import { useThreadPageMutations } from './useThreadPageMutations'
import { useThreadPageRailState } from './useThreadPageRailState'
import { useThreadPageStatusState } from './useThreadPageStatusState'
import { useThreadViewportState } from './useThreadViewportState'

export type ControllerState = ReturnType<typeof useThreadPageControllerState>
export type DataState = ReturnType<typeof useThreadPageData>
export type RailState = ReturnType<typeof useThreadPageRailState>
export type MutationState = ReturnType<typeof useThreadPageMutations>
export type PanelState = ReturnType<typeof useThreadPageComposerPanelState>
export type DisplayState = ReturnType<typeof useThreadPageDisplayState>
export type ViewportState = ReturnType<typeof useThreadViewportState>
export type StatusState = ReturnType<typeof useThreadPageStatusState>
export type ComposerActions = ReturnType<typeof useThreadComposerActions>
export type PageActions = ReturnType<typeof useThreadPageActions>
export type ComposerCallbacks = ReturnType<typeof useThreadPageComposerCallbacks>

export type ThreadPageControllerData = {
  controllerState: ControllerState
  dataState: DataState
  displayState: DisplayState
  mutationState: MutationState
  panelState: PanelState
  railState: RailState
  statusState: StatusState
  viewportState: ViewportState
}

export type ThreadPageControllerActions = {
  composerActions: ComposerActions
  composerCallbacks: ComposerCallbacks
  pageActions: PageActions
}

export type UseThreadPageControllerActionsInput = ThreadPageControllerData

export type UseThreadPageControllerEffectsInput = Pick<
  ThreadPageControllerData,
  'controllerState' | 'dataState' | 'statusState'
>

export type BuildThreadPageControllerLayoutPropsInput = ThreadPageControllerData &
  ThreadPageControllerActions
