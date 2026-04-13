import { useLayoutEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import {
  DEFAULT_THREAD_TURN_WINDOW_SIZE,
  useThreadPageControllerLocalState,
} from './useThreadPageControllerLocalState'
import { useThreadPageControllerRuntimeState } from './useThreadPageControllerRuntimeState'
import { useThreadPageControllerStoreState } from './useThreadPageControllerStoreState'

export function useThreadPageControllerState() {
  const navigate = useNavigate()
  const { workspaceId = '', threadId } = useParams()
  const localState = useThreadPageControllerLocalState()
  const storeState = useThreadPageControllerStoreState(workspaceId, threadId)

  useLayoutEffect(() => {
    localState.setBotSendError(null)
    localState.setBotSendText('')
    localState.setFullTurnItemContentOverridesById({})
    localState.setFullTurnItemRetainCountById({})
    localState.setFullTurnItemOverridesById({})
    localState.setFullTurnRetainCountById({})
    localState.setFullTurnOverridesById({})
    localState.setHistoricalTurns([])
    localState.setHasMoreHistoricalTurnsBefore(null)
    localState.setIsLoadingOlderTurns(false)
    localState.setThreadTurnWindowSize(DEFAULT_THREAD_TURN_WINDOW_SIZE)
  }, [
    localState.setBotSendError,
    localState.setBotSendText,
    localState.setFullTurnItemContentOverridesById,
    localState.setFullTurnItemOverridesById,
    localState.setFullTurnItemRetainCountById,
    localState.setFullTurnOverridesById,
    localState.setFullTurnRetainCountById,
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
    navigate,
    routeThreadId: threadId,
    workspaceId,
  }
}
