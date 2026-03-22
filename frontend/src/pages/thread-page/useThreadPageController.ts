import { buildThreadPageControllerLayoutProps } from './buildThreadPageControllerLayoutProps'
import { useThreadPageControllerActions } from './useThreadPageControllerActions'
import { useThreadPageControllerData } from './useThreadPageControllerData'
import { useThreadPageControllerEffects } from './useThreadPageControllerEffects'
import { useThreadPageControllerState } from './useThreadPageControllerState'

export function useThreadPageController() {
  const controllerState = useThreadPageControllerState()
  const controllerData = useThreadPageControllerData(controllerState)
  const controllerActions = useThreadPageControllerActions(controllerData)

  useThreadPageControllerEffects(controllerData)

  return buildThreadPageControllerLayoutProps({
    ...controllerData,
    ...controllerActions,
  })
}


