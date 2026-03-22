import type { CSSProperties } from 'react'

import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { i18n } from '../../i18n/runtime'
import { ThreadComposerDock } from './ThreadComposerDock'
import { ThreadTerminalDock } from './ThreadTerminalDock'
import { ThreadWorkbenchRail } from './ThreadWorkbenchRail'
import { ThreadWorkbenchSurface } from './ThreadWorkbenchSurface'

type ThreadPageLayoutProps = {
  closeWorkbenchOverlay: () => void
  composerDockProps: Parameters<typeof ThreadComposerDock>[0]
  confirmDialogProps?: Parameters<typeof ConfirmDialog>[0] | null
  isMobileViewport: boolean
  isMobileWorkbenchOverlayOpen: boolean
  railProps: Parameters<typeof ThreadWorkbenchRail>[0]
  surfaceProps: Omit<Parameters<typeof ThreadWorkbenchSurface>[0], 'children'>
  terminalDockProps?: Parameters<typeof ThreadTerminalDock>[0]
  workbenchLayoutStyle: CSSProperties
}

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
