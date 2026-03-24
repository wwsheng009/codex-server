import type { QueryClient } from '@tanstack/react-query'
import type { Dispatch, SetStateAction } from 'react'

import type { ThreadTerminalDockProps } from '../../features/thread-terminal'
import type { SurfacePanelSide, SurfacePanelView } from '../../lib/layout-config'
import type { PendingThreadTurn } from '../threadPageTurnHelpers'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { ThreadComposerDock } from './ThreadComposerDock'
import { ThreadWorkbenchRail } from './ThreadWorkbenchRail'
import { ThreadWorkbenchSurface } from './ThreadWorkbenchSurface'

export type SurfaceProps = Omit<Parameters<typeof ThreadWorkbenchSurface>[0], 'children'>
export type ComposerDockProps = Parameters<typeof ThreadComposerDock>[0]
export type TerminalDockProps = ThreadTerminalDockProps
export type RailProps = Parameters<typeof ThreadWorkbenchRail>[0]
export type ConfirmDialogProps = Parameters<typeof ConfirmDialog>[0]

export type BuildThreadPageLayoutPropsInput =
  Omit<SurfaceProps, 'threadLoadErrorMessage' | 'onRetryThreadLoad' | 'onToggleSurfacePanelSide'>
  & ComposerDockProps
  & RailProps
  & Omit<
    TerminalDockProps,
    | 'className'
    | 'isExpanded'
    | 'isFloating'
    | 'isVisible'
    | 'isWindowMaximized'
    | 'onDragStart'
    | 'onHide'
    | 'onResetFloatingBounds'
    | 'onShow'
    | 'onStartShellSession'
    | 'onStartCommandLine'
    | 'onToggleExpanded'
    | 'onToggleWindowMaximized'
    | 'onWindowResizeStart'
    | 'style'
  >
  & {
    activePendingTurn: PendingThreadTurn | null
    confirmDialogError: unknown
    confirmingThreadDelete: { name: string } | null
    isTerminalDockExpanded: TerminalDockProps['isExpanded']
    isTerminalDockVisible: TerminalDockProps['isVisible']
    onCloseDeleteThreadDialog: ConfirmDialogProps['onClose']
    onConfirmDeleteThreadDialog: ConfirmDialogProps['onConfirm']
    onHideTerminalDock: TerminalDockProps['onHide']
    onResetTerminalWindowBounds: TerminalDockProps['onResetFloatingBounds']
    onReleaseFullTurn: SurfaceProps['onReleaseFullTurn']
    onRetainFullTurn: SurfaceProps['onRetainFullTurn']
    onStartTerminalShellSession: TerminalDockProps['onStartShellSession']
    onStartTerminalCommandLine: TerminalDockProps['onStartCommandLine']
    onStartTerminalWindowDrag: TerminalDockProps['onDragStart']
    onStartTerminalWindowResize: TerminalDockProps['onWindowResizeStart']
    onShowTerminalDock: TerminalDockProps['onShow']
    onToggleArchivedSession: TerminalDockProps['onToggleArchivedSession']
    onToggleTerminalWindowMaximized: TerminalDockProps['onToggleWindowMaximized']
    queryClient: QueryClient
    setIsTerminalDockExpanded: Dispatch<SetStateAction<boolean>>
    setIsTerminalDockVisible: Dispatch<SetStateAction<boolean>>
    setSurfacePanelSides: Dispatch<
      SetStateAction<Record<SurfacePanelView, SurfacePanelSide>>
    >
    isTerminalWindowMaximized: TerminalDockProps['isWindowMaximized']
    startTerminalCommandPending: TerminalDockProps['startCommandPending']
    terminalDockClassName: TerminalDockProps['className']
    terminalWindowBounds: {
      x: number
      y: number
      width: number
      height: number
    }
  }
