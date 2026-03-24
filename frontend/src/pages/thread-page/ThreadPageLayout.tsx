import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { ThreadTerminalDock } from '../../features/thread-terminal'
import { i18n } from '../../i18n/runtime'
import { ThreadComposerDock } from './ThreadComposerDock'
import { ThreadWorkbenchRail } from './ThreadWorkbenchRail'
import { ThreadWorkbenchSurface } from './ThreadWorkbenchSurface'
import type { ThreadPageLayoutProps } from './threadPageLayoutPropTypes'

export function ThreadPageLayout({
  closeWorkbenchOverlay,
  composerDockProps,
  confirmDialogProps,
  isMobileViewport,
  isMobileWorkbenchOverlayOpen,
  railProps,
  surfaceProps,
  terminalDockProps,
  workbenchLayoutStyle,
}: ThreadPageLayoutProps) {
  return (
    <section
      className={
        isMobileViewport
          ? 'screen workbench-screen workbench-screen--mobile'
          : 'screen workbench-screen'
      }
    >
      {isMobileWorkbenchOverlayOpen ? (
        <button
          aria-label={i18n._({
            id: 'Close workbench panel',
            message: 'Close workbench panel',
          })}
          className="workbench-mobile-backdrop"
          onClick={closeWorkbenchOverlay}
          type="button"
        />
      ) : null}
      <div className="workbench-layout" style={workbenchLayoutStyle}>
        <section className="workbench-main">
          <section className="workbench-surface workbench-surface--ide">
            <ThreadWorkbenchSurface {...surfaceProps}>
              <ThreadComposerDock {...composerDockProps} />
            </ThreadWorkbenchSurface>

            {terminalDockProps ? <ThreadTerminalDock {...terminalDockProps} /> : null}
          </section>
        </section>

        <ThreadWorkbenchRail {...railProps} />
      </div>

      {confirmDialogProps ? <ConfirmDialog {...confirmDialogProps} /> : null}
    </section>
  )
}
