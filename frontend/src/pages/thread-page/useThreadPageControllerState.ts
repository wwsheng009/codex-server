import { useEffect } from 'react'
import { useParams } from 'react-router-dom'

import {
  DEFAULT_THREAD_TURN_WINDOW_SIZE,
  useThreadPageControllerLocalState,
} from './useThreadPageControllerLocalState'
import { useThreadPageControllerRuntimeState } from './useThreadPageControllerRuntimeState'
import { useThreadPageControllerStoreState } from './useThreadPageControllerStoreState'

export function useThreadPageControllerState() {
  const { workspaceId = '' } = useParams()
  const localState = useThreadPageControllerLocalState()
  const storeState = useThreadPageControllerStoreState(workspaceId)

  useEffect(() => {
    localState.setHistoricalTurns([])
    localState.setHasMoreHistoricalTurnsBefore(null)
    localState.setIsLoadingOlderTurns(false)
    localState.setThreadTurnWindowSize(DEFAULT_THREAD_TURN_WINDOW_SIZE)
  }, [
    localState.setHasMoreHistoricalTurnsBefore,
    localState.setHistoricalTurns,
    localState.setIsLoadingOlderTurns,
    localState.setThreadTurnWindowSize,
    storeState.selectedThreadId,
    workspaceId,
  ])

  const runtimeState = useThreadPageControllerRuntimeState({
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
