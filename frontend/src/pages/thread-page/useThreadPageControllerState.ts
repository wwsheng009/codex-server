import { useParams } from 'react-router-dom'

import { useThreadPageControllerLocalState } from './useThreadPageControllerLocalState'
import { useThreadPageControllerRuntimeState } from './useThreadPageControllerRuntimeState'
import { useThreadPageControllerStoreState } from './useThreadPageControllerStoreState'

export function useThreadPageControllerState() {
  const { workspaceId = '' } = useParams()
  const localState = useThreadPageControllerLocalState()
  const { allThreadEvents, ...storeState } = useThreadPageControllerStoreState(workspaceId)
  const runtimeState = useThreadPageControllerRuntimeState({
    allThreadEvents,
    composerInputRef: localState.composerInputRef,
    isMobileViewport: storeState.isMobileViewport,
    selectedThreadId: storeState.selectedThreadId,
    workspaceId,
  })

  return {
    ...localState,
    ...runtimeState,
    ...storeState,
    workspaceId,
  }
}
