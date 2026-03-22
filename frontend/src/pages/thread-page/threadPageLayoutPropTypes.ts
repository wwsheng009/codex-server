import type { QueryClient } from '@tanstack/react-query'
import type { Dispatch, SetStateAction } from 'react'

import type { SurfacePanelSide, SurfacePanelView } from '../../lib/layout-config'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { ThreadComposerDock } from './ThreadComposerDock'
import { ThreadTerminalDock } from './ThreadTerminalDock'
import { ThreadWorkbenchRail } from './ThreadWorkbenchRail'
import { ThreadWorkbenchSurface } from './ThreadWorkbenchSurface'

export type SurfaceProps = Omit<Parameters<typeof ThreadWorkbenchSurface>[0], 'children'>
export type ComposerDockProps = Parameters<typeof ThreadComposerDock>[0]
export type TerminalDockProps = Parameters<typeof ThreadTerminalDock>[0]
export type RailProps = Parameters<typeof ThreadWorkbenchRail>[0]
export type ConfirmDialogProps = Parameters<typeof ConfirmDialog>[0]

export type BuildThreadPageLayoutPropsInput =
  Omit<SurfaceProps, 'threadLoadErrorMessage' | 'onRetryThreadLoad' | 'onToggleSurfacePanelSide'>
  & ComposerDockProps
  & RailProps
  & Omit<TerminalDockProps, 'className' | 'isExpanded' | 'onToggleExpanded'>
  & {
    confirmDialogError: unknown
    confirmingThreadDelete: { name: string } | null
    isTerminalDockExpanded: TerminalDockProps['isExpanded']
    onCloseDeleteThreadDialog: ConfirmDialogProps['onClose']
    onConfirmDeleteThreadDialog: ConfirmDialogProps['onConfirm']
    queryClient: QueryClient
    setIsTerminalDockExpanded: Dispatch<SetStateAction<boolean>>
    setSurfacePanelSides: Dispatch<
      SetStateAction<Record<SurfacePanelView, SurfacePanelSide>>
    >
    terminalDockClassName: TerminalDockProps['className']
  }
