import {
  ApprovalIcon,
  ContextIcon,
  FeedIcon,
  PanelOpenIcon,
  PlanIcon,
  RailIconButton,
  TerminalIcon,
  ToolsIcon,
} from '../../components/ui/RailControls'
import { i18n } from '../../i18n/runtime'
import {
  activateThreadWorkbenchRailPanel,
  THREAD_WORKBENCH_RAIL_PANEL_IDS,
} from './threadWorkbenchRailPanelState'
import type { ThreadWorkbenchRailCollapsedProps } from './threadWorkbenchRailTypes'

export function ThreadWorkbenchRailCollapsed({
  isTerminalDockVisible,
  onOpenInspector,
  onOpenSurfacePanel,
  onShowTerminalDock,
}: ThreadWorkbenchRailCollapsedProps) {
  function handleOpenPanel(panelId: keyof typeof THREAD_WORKBENCH_RAIL_PANEL_IDS) {
    activateThreadWorkbenchRailPanel(THREAD_WORKBENCH_RAIL_PANEL_IDS[panelId])
    onOpenInspector()
  }

  return (
    <aside className="workbench-pane workbench-pane--collapsed">
      <div className="workbench-pane__collapsed">
        <RailIconButton
          aria-label={i18n._({
            id: 'Open side rail',
            message: 'Open side rail',
          })}
          className="workbench-pane__mini-button"
          onClick={() => handleOpenPanel('overview')}
          primary
          title={i18n._({
            id: 'Open side rail',
            message: 'Open side rail',
          })}
        >
          <PanelOpenIcon />
        </RailIconButton>
        <RailIconButton
          aria-label={i18n._({
            id: 'Open workspace context',
            message: 'Open workspace context',
          })}
          className="workbench-pane__mini-button"
          onClick={() => handleOpenPanel('overview')}
          title={i18n._({
            id: 'Context',
            message: 'Context',
          })}
        >
          <ContextIcon />
        </RailIconButton>
        <RailIconButton
          aria-label={i18n._({
            id: 'Open live feed panel',
            message: 'Open live feed panel',
          })}
          className="workbench-pane__mini-button"
          onClick={() => onOpenSurfacePanel('feed')}
          title={i18n._({
            id: 'Feed',
            message: 'Feed',
          })}
        >
          <FeedIcon />
        </RailIconButton>
        <RailIconButton
          aria-label={i18n._({
            id: 'Open plans panel',
            message: 'Open plans panel',
          })}
          className="workbench-pane__mini-button"
          onClick={() => onOpenSurfacePanel('plans')}
          title={i18n._({
            id: 'Plans',
            message: 'Plans',
          })}
        >
          <PlanIcon />
        </RailIconButton>
        <RailIconButton
          aria-label={i18n._({
            id: 'Open approvals panel',
            message: 'Open approvals panel',
          })}
          className="workbench-pane__mini-button"
          onClick={() => onOpenSurfacePanel('approvals')}
          title={i18n._({
            id: 'Approvals',
            message: 'Approvals',
          })}
        >
          <ApprovalIcon />
        </RailIconButton>
        <RailIconButton
          aria-label={i18n._({
            id: 'Open workbench tools',
            message: 'Open workbench tools',
          })}
          className="workbench-pane__mini-button"
          onClick={() => handleOpenPanel('tools')}
          title={i18n._({
            id: 'Tools',
            message: 'Tools',
          })}
        >
          <ToolsIcon />
        </RailIconButton>
        {!isTerminalDockVisible ? (
          <RailIconButton
            aria-label={i18n._({
              id: 'Show terminal',
              message: 'Show terminal',
            })}
            className="workbench-pane__mini-button"
            onClick={onShowTerminalDock}
            title={i18n._({
              id: 'Show terminal',
              message: 'Show terminal',
            })}
          >
            <TerminalIcon />
          </RailIconButton>
        ) : null}
      </div>
    </aside>
  )
}
