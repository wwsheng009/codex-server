import { i18n } from '../../i18n/runtime'
import type { ThreadWorkbenchRailMobileQuickActionsProps } from './threadWorkbenchRailTypes'

export function ThreadWorkbenchRailMobileQuickActions({
  onOpenSurfacePanel,
  surfacePanelView,
}: ThreadWorkbenchRailMobileQuickActionsProps) {
  return (
    <div className="pane-section">
      <div className="section-header section-header--inline">
        <div>
          <h2>
            {i18n._({
              id: 'Quick actions',
              message: 'Quick actions',
            })}
          </h2>
          <p>
            {i18n._({
              id: 'Only open side panels when you need them.',
              message: 'Only open side panels when you need them.',
            })}
          </p>
        </div>
      </div>
      <div className="workbench-mobile-actions">
        <button
          className={
            surfacePanelView === 'feed'
              ? 'pane-section__toggle workbench-mobile-actions__button workbench-mobile-actions__button--active'
              : 'pane-section__toggle workbench-mobile-actions__button'
          }
          onClick={() => onOpenSurfacePanel('feed')}
          type="button"
        >
          {i18n._({
            id: 'Feed',
            message: 'Feed',
          })}
        </button>
        <button
          className={
            surfacePanelView === 'plans'
              ? 'pane-section__toggle workbench-mobile-actions__button workbench-mobile-actions__button--active'
              : 'pane-section__toggle workbench-mobile-actions__button'
          }
          onClick={() => onOpenSurfacePanel('plans')}
          type="button"
        >
          {i18n._({
            id: 'Plans',
            message: 'Plans',
          })}
        </button>
        <button
          className={
            surfacePanelView === 'approvals'
              ? 'pane-section__toggle workbench-mobile-actions__button workbench-mobile-actions__button--active'
              : 'pane-section__toggle workbench-mobile-actions__button'
          }
          onClick={() => onOpenSurfacePanel('approvals')}
          type="button"
        >
          {i18n._({
            id: 'Approvals',
            message: 'Approvals',
          })}
        </button>
      </div>
    </div>
  )
}
