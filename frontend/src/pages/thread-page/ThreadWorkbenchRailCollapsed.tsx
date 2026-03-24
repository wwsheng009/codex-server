import {
  ApprovalIcon,
  ContextIcon,
  FeedIcon,
  PanelOpenIcon,
  RailIconButton,
  ToolsIcon,
} from '../../components/ui/RailControls'
import { i18n } from '../../i18n/runtime'
import type { ThreadWorkbenchRailCollapsedProps } from './threadWorkbenchRailTypes'

export function ThreadWorkbenchRailCollapsed({
  onOpenInspector,
  onOpenSurfacePanel,
}: ThreadWorkbenchRailCollapsedProps) {
  return (
    <aside className="workbench-pane workbench-pane--collapsed">
      <div className="workbench-pane__collapsed">
        <RailIconButton
          aria-label={i18n._({
            id: 'Open side rail',
            message: 'Open side rail',
          })}
          className="workbench-pane__mini-button"
          onClick={onOpenInspector}
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
          onClick={onOpenInspector}
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
          onClick={onOpenInspector}
          title={i18n._({
            id: 'Tools',
            message: 'Tools',
          })}
        >
          <ToolsIcon />
        </RailIconButton>
      </div>
    </aside>
  )
}
